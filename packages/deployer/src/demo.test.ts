import { describe, expect, it } from "bun:test"
import type { ClaimTicket, DepositDraft } from "@inference-money/bridge-core"
import { type PlanStore, runSetup, type Seed, type SetupOps, type SetupPlan } from "./demo"

const memoryStore = () => {
	let plan: SetupPlan | undefined
	const store: PlanStore = {
		read: () => (plan ? structuredClone(plan) : undefined),
		write: (p) => {
			plan = structuredClone(p)
		},
		clear: () => {
			plan = undefined
		},
	}
	return { store, current: () => plan }
}

const draftOf = (seed: Seed) => ({ intent: { amount: 1n, kind: "private" }, seed }) as unknown as DepositDraft
const ticketOf = (seed: Seed) => ({ draft: draftOf(seed), messageHash: "0x01", leafIndex: 0n, depositor: "0x02" }) as unknown as ClaimTicket
const seedOf = (t: ClaimTicket) => (t.draft as unknown as { seed: Seed }).seed

function fakeOps(over: Partial<SetupOps> & { finality?: SetupOps["final"]["finality"] } = {}) {
	const calls = { deposits: [] as Seed[], claims: [] as Seed[], reclaims: [] as Seed[] }
	const ops: SetupOps = {
		prepare: async () => {},
		deposit: async (seed) => {
			calls.deposits.push(seed)
			return ticketOf(seed)
		},
		claim: async (t) => {
			calls.claims.push(seedOf(t))
		},
		final: {
			finality: over.finality ?? (async () => "finalized"),
			reconcile: async (t) => t,
			claimAgain: async (t) => {
				calls.reclaims.push(seedOf(t))
			},
			pause: async () => {},
			log: () => {},
		},
		...over,
	}
	return { ops, calls }
}

describe("demo setup", () => {
	it("publishes the users' tag only once both bindings are finalized, re-claiming a pruned one first", async () => {
		const { store, current } = memoryStore()
		const bobFinal = Promise.withResolvers<"finalized">()
		const bobAnswers: Promise<"finalized" | "dropped">[] = [Promise.resolve("dropped"), bobFinal.promise]
		let asked = 0
		const finality = async (t: ClaimTicket) => {
			if (seedOf(t) !== "bob") return "finalized" as const
			asked++
			return bobAnswers.shift() as Promise<"finalized" | "dropped">
		}
		const { ops, calls } = fakeOps({ finality })
		const published: string[] = []
		const run = runSetup(store, ops, (tag) => published.push(tag))

		while (asked < 2) await Bun.sleep(1)
		expect(published).toEqual([])
		expect(calls.reclaims).toEqual(["bob"])
		expect(current()?.tag).toMatch(/^[0-9a-f]{32}$/)

		bobFinal.resolve("finalized")
		await run
		expect(calls.claims).toEqual(["alice", "bob", "galactica"])
		expect(published).toHaveLength(1)
		expect(current()).toBeUndefined()
	})

	it("resumes an interrupted setup with its own tag, recovering a deposit sent before the crash instead of repeating it", async () => {
		const { store, current } = memoryStore()
		const crash = fakeOps({
			deposit: async (seed, _tag, _prior, persist) => {
				if (seed === "alice") return ticketOf("alice")
				persist(draftOf(seed))
				throw new Error("killed while bob's deposit was in flight")
			},
		})
		await expect(runSetup(store, crash.ops, () => {})).rejects.toThrow("in flight")
		const tag = current()?.tag
		expect(Object.keys(current()?.tickets ?? {})).toEqual(["alice"])
		expect(Object.keys(current()?.drafts ?? {})).toEqual(["bob"])

		const priors: (Seed | undefined)[] = []
		const resume = fakeOps({
			deposit: async (seed, _tag, prior) => {
				priors.push(prior && (prior as unknown as { seed: Seed }).seed)
				return ticketOf(seed)
			},
		})
		const published: string[] = []
		await runSetup(store, resume.ops, (t) => published.push(t))
		expect(priors).toEqual(["bob", undefined])
		expect(published).toEqual([tag as string])
	})
})
