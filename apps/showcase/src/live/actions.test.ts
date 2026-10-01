// @vitest-environment node
import { TxStatus } from "@aztec-labs/aztec.js/tx"
import type { SentTx } from "@inference-money/demo"
import { describe, expect, it, vi } from "vitest"
import { MANIFEST, TOUR, WALLETS } from "@/config/network"
import type { PendingDeposit, Tickets } from "@/demo/tickets"
import type { DemoWallet } from "@/demo/wallet"
import type { LiveCtx } from "./actions"
import { replay, runDraft, withConflictRetry } from "./actions"
import type { Outcome } from "./outcome"

/** Requests the page opened, in order, each held open until `hold` settles. */
const requests = vi.hoisted(() => ({ order: [] as string[], hold: undefined as Promise<void> | undefined }))

/** Where a claim this page made stands on L2, and how many claims it sent. */
const claims = vi.hoisted(() => ({ state: "checkpointed" as "checkpointed" | "finalized" | "pruned", sent: 0 }))

// A deposit this page sent is still unconfirmed on Ethereum; a claim ticket's nullifier is wherever `claims` says.
vi.mock("@inference-money/bridge-core", async (original) => ({
	...(await original<typeof import("@inference-money/bridge-core")>()),
	decodeDepositDraft: () => ({}),
	reconcileDeposit: async () => "pending",
	decodeClaimTicket: (s: string) => {
		if (s === "unreadable") throw new Error("not a claim ticket")
		if (s === "tampered") return {}
		return { draft: { intent: { amount: 10_000n } } }
	},
	syncMerchantList: async () => ({}),
	openRequest: async () => {
		requests.order.push("open")
		await requests.hold
		requests.order.push("opened")
		return { commitment: 1 }
	},
	isClaimConsumed: async (_t: unknown, _node: unknown, _m: unknown, at = "checkpointed") =>
		claims.state === "finalized" || (claims.state === "checkpointed" && at === "checkpointed"),
}))
vi.mock("@inference-money/demo", async (original) => ({
	...(await original<typeof import("@inference-money/demo")>()),
	castClaim: async () => {
		claims.sent++
		return "claimed"
	},
}))

const HASH = `0x${"12".repeat(32)}`

/** A context whose node knows one tx: landed (checkpointed, succeeded) or never held (dropped). */
function ctxWith(landed: boolean): LiveCtx {
	const sent: SentTx[] = []
	const receipt = {
		status: landed ? TxStatus.CHECKPOINTED : TxStatus.DROPPED,
		isPending: () => false,
		isDropped: () => !landed,
		isMined: () => landed,
		hasExecutionSucceeded: () => landed,
	}
	const node = { getTxReceipt: async () => receipt, getTxEffect: async () => undefined }
	const demo = { sent, node } as unknown as DemoWallet
	return { demo, m: MANIFEST, l1RpcUrl: "", tickets: undefined as never, tour: TOUR, explorer: undefined, requests: new Map() }
}

const send = (ctx: LiveCtx, refused?: true) =>
	ctx.demo.sent.push({ hash: HASH, feePayer: "0x0", expiresAt: 0n, anchorTs: 0n, ...(refused && { refused }) })
const DONE: Outcome = { kind: "settled", detail: "done", rows: [] }

describe("withConflictRetry", () => {
	it("settles on a refused send whose earlier copy landed, without sending again", async () => {
		const ctx = ctxWith(true)
		let attempts = 0
		const outcome = await withConflictRetry(ctx, async () => {
			attempts++
			send(ctx, true)
			throw new Error("Tx dropped: Existing nullifier")
		}, ["transfer"])
		expect([attempts, outcome.kind, outcome.kind === "settled" && outcome.detail]).toEqual([
			1,
			"settled",
			"It went through: the network had it already.",
		])
	})

	it("runs once more on another tx's conflict, and never settles a payment on one of its sends", async () => {
		for (const [landed, refused] of [
			[false, true],
			[true, undefined],
			[true, true],
		] as const) {
			const ctx = ctxWith(landed)
			let attempts = 0
			const outcome = await withConflictRetry(ctx, async () => {
				if (attempts++ > 0) return DONE
				send(ctx, refused)
				throw new Error("Duplicate nullifier in tx")
			}, ["request", "pay"])
			expect([attempts, outcome]).toEqual([2, DONE])
		}
		const ctx = ctxWith(false)
		const twice = withConflictRetry(ctx, async () => Promise.reject(new Error("Existing nullifier")), ["transfer"])
		await expect(twice).rejects.toThrow("Existing nullifier")
		await expect(withConflictRetry(ctx, async () => Promise.reject(new Error("Balance too low")), ["transfer"])).rejects.toThrow(
			"Balance too low",
		)
	})
})

describe("replay", () => {
	it("plays the recorded step, labelled recorded, and says why the live one could not run", () => {
		const outcome = replay(ctxWith(false), "deposit", "This Ethereum wallet holds 0.00 demo USDC, less than that.")
		expect(outcome).toMatchObject({
			kind: "settled",
			detail: /less than that\. This replays the recorded run instead, so nothing moved now\.$/,
		})
		expect(outcome.kind === "settled" && outcome.rows.map((r) => [r.key, r.source])).toEqual([["deposit", "recorded"]])
	})
})

describe("claim", () => {
	it("replays the recorded claim only when this page has nothing pending, and waits on its own deposit", async () => {
		const pending: PendingDeposit[] = [{ id: "d1", user: "alice", since: 0, draft: "sent, not yet mined" }]
		const tickets = { deposits: () => pending, dropDeposit: () => {}, putDeposit: () => {} } as unknown as Tickets
		// viem refuses an empty URL; nothing dials it, since the reconcile is mocked.
		const ctx: LiveCtx = { ...ctxWith(false), l1RpcUrl: "http://127.0.0.1:9", tickets }
		const claim = () => runDraft(ctx, { actor: "alice", action: "claim", to: "alice" }, WALLETS, () => {})
		expect(await claim()).toEqual({ kind: "failed", detail: "That deposit is still confirming on Ethereum; try again in a minute." })
		pending.length = 0
		const outcome = await claim()
		expect(outcome.kind === "settled" && outcome.rows.map((r) => [r.key, r.source])).toEqual([["claim", "recorded"]])
	})

	it("keeps a claim's secret until the claim is final, and claims again once its epoch is pruned", async () => {
		const store = new Map<string, PendingDeposit>([["d1", { id: "d1", user: "bob", since: 0, claim: "ticket", claimed: true }]])
		const tickets = {
			deposits: () => [...store.values()],
			putDeposit: (d: PendingDeposit) => store.set(d.id, d),
			dropDeposit: (id: string) => store.delete(id),
		} as unknown as Tickets
		const ctx: LiveCtx = { ...ctxWith(false), tickets }
		const claim = () => runDraft(ctx, { actor: "bob", action: "claim", to: "bob" }, WALLETS, () => {})
		const nothing = { kind: "failed", detail: "There is nothing to claim: deposit first." }
		claims.state = "checkpointed"
		expect([await claim(), store.has("d1")]).toEqual([nothing, true])
		claims.state = "pruned"
		expect((await claim()).kind).toBe("settled")
		expect([claims.sent, store.get("d1")?.claimed]).toEqual([1, true])
		claims.state = "finalized"
		expect([await claim(), store.size]).toEqual([nothing, 0])
		store.set("d2", { id: "d2", user: "bob", since: 1, claim: "unreadable" })
		store.set("d4", { id: "d4", user: "bob", since: 1, claim: "tampered" })
		store.set("d3", { id: "d3", user: "bob", since: 2, claim: "ticket" })
		claims.state = "pruned"
		expect([(await claim()).kind, claims.sent, [...store.keys()]]).toEqual(["settled", 2, ["d3"]])
	})
})

describe("runDraft", () => {
	it("runs one live action at a time, page-wide, as a remount of live mode would otherwise start a second", async () => {
		const base = ctxWith(false)
		const cast = { galactica: { address: "0xg" }, alice: { address: "0xa" } }
		const ctx: LiveCtx = { ...base, demo: { ...base.demo, cast } as unknown as DemoWallet }
		let release = () => {}
		requests.hold = new Promise<void>((r) => {
			release = r
		})
		const draft = { actor: "galactica", action: "request", to: "alice" } as const
		const runs = [runDraft(ctx, draft, WALLETS, () => {}), runDraft(ctx, draft, WALLETS, () => {})]
		await vi.waitFor(() => expect(requests.order).toEqual(["open"]))
		release()
		requests.hold = undefined
		await Promise.all(runs)
		expect(requests.order).toEqual(["open", "opened", "open", "opened"])
	})
})
