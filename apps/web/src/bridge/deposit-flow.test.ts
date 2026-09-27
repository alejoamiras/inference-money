// @vitest-environment node
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { SponsorUnavailableError } from "@inference-money/bridge-core"
import { pad } from "viem"
import { describe, expect, it, vi } from "vitest"
import { DepositFlow } from "./deposit-flow"
import { deferred, fakeEnv, stepsOf, ticketFor } from "./test/fake-env"

const ZERO_WORD = pad("0x0")
const AMOUNT = 25_000_000n
const until = async (cond: () => boolean) => {
	for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 0))
	expect(cond()).toBe(true)
}
const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)).toLowerCase()

describe("DepositFlow", () => {
	it("registers the draft before the signature, and a private deposit never names its recipient", async () => {
		const f = await fakeEnv()
		const flow = new DepositFlow(f.env)
		const steps = stepsOf(flow.store)
		f.l1.allowance = 0n
		f.l1.onSign = () => expect(f.env.inFlight.size).toBe(1)

		await flow.confirm({ amount: AMOUNT, kind: "private", recipient: f.account.toString() })

		expect(steps).toEqual(["checking", "approving", "signing", "sending", "confirming", "waiting", "claiming", "finalizing", "done"])
		expect(flow.store.get()).toMatchObject({ outcome: "claimed", recipient: f.account.toString() })
		expect(f.env.inFlight.size).toBe(0)
		const [approve, deposit] = f.l1.sends
		expect(approve?.functionName).toBe("approve")
		expect(deposit?.args[1]).toBe(ZERO_WORD)
		expect(f.l1.signs[0]?.message).toMatchObject({ witness: { aztecRecipient: ZERO_WORD, isPrivate: true } })
		expect(json([f.l1.signs, deposit])).not.toContain(f.account.toString().slice(2))
	})

	it("keeps the deposit guarded until its claim is finalized, and claims again when a prune drops it", async () => {
		const final = deferred<"finalized" | "dropped">()
		const waitClaimFinalized = vi.fn().mockResolvedValueOnce("dropped").mockReturnValueOnce(final.promise)
		const claim = vi.fn().mockResolvedValue("claimed")
		const f = await fakeEnv({ waitClaimFinalized, claim })
		const flow = new DepositFlow(f.env)
		const done = flow.confirm({ amount: AMOUNT, kind: "private", recipient: f.account.toString() })

		await until(() => waitClaimFinalized.mock.calls.length === 2)
		expect(claim, "a pruned claim is sent again from the kept ticket").toHaveBeenCalledTimes(2)
		expect(flow.store.get().step).toBe("finalizing")
		expect(f.env.inFlight.size, "the secret stays guarded until the claim is final").toBe(1)
		final.resolve("finalized")
		await done
		expect(flow.store.get()).toMatchObject({ step: "done", outcome: "claimed" })
		expect(f.env.inFlight.size).toBe(0)
	})

	it.each([
		["the USDC balance", (f: Awaited<ReturnType<typeof fakeEnv>>) => (f.l1.readError = new Error("RPC 503"))],
		[
			"the fee estimate",
			(f: Awaited<ReturnType<typeof fakeEnv>>) => (f.env.ops.predictedWorstMinFees = () => Promise.reject(new Error("503"))),
		],
		["the pause flag", (f: Awaited<ReturnType<typeof fakeEnv>>) => (f.env.ops.isBridgePaused = () => Promise.reject(new Error("503")))],
		["a paused bridge", (f: Awaited<ReturnType<typeof fakeEnv>>) => (f.node.paused = true)],
		["a short balance", (f: Awaited<ReturnType<typeof fakeEnv>>) => (f.l1.balance = AMOUNT - 1n)],
	])("signs nothing when a confirm-time read fails: %s", async (_, breakIt) => {
		const f = await fakeEnv()
		breakIt(f)
		const flow = new DepositFlow(f.env)
		await flow.confirm({ amount: AMOUNT, kind: "public", recipient: f.account.toString() })
		expect(flow.store.get()).toMatchObject({ step: "idle", notice: expect.any(String) })
		expect(f.l1.signs).toHaveLength(0)
		expect(f.l1.sends).toHaveLength(0)
		expect(f.env.inFlight.size).toBe(0)
	})

	it("refuses the send when the bridge pauses while the wallet prompt is open", async () => {
		const f = await fakeEnv()
		f.l1.onSign = () => {
			f.node.paused = true
		}
		const flow = new DepositFlow(f.env)
		await flow.confirm({ amount: AMOUNT, kind: "public", recipient: f.account.toString() })
		expect(f.l1.signs).toHaveLength(1)
		expect(f.l1.sends).toHaveLength(0)
		expect(flow.store.get()).toMatchObject({ step: "idle", notice: expect.stringContaining("paused") })
		expect(f.env.inFlight.size).toBe(0)
	})

	it("keeps a sent deposit through receipt trouble: re-checks never re-send, discard only once proven never deposited", async () => {
		const reconcile = vi.fn().mockResolvedValueOnce("pending").mockResolvedValueOnce("not-deposited")
		const f = await fakeEnv({ confirmDeposit: () => Promise.reject(new Error("timed out")), reconcileDeposit: reconcile })
		const flow = new DepositFlow(f.env)
		await flow.confirm({ amount: AMOUNT, kind: "public", recipient: f.account.toString() })
		expect(flow.store.get()).toMatchObject({ step: "stuck", canDiscard: false })

		await flow.discard()
		expect(flow.store.get().step).toBe("stuck")
		await flow.recheck()
		expect(flow.store.get()).toMatchObject({ step: "stuck", canDiscard: false })
		expect(f.env.inFlight.size).toBe(1)
		await flow.recheck()
		expect(flow.store.get()).toMatchObject({ step: "stuck", canDiscard: true })
		await flow.discard()

		expect(flow.store.get().step).toBe("idle")
		expect(f.env.inFlight.size).toBe(0)
		expect(f.l1.sends).toHaveLength(1)
	})

	it("a send the wallet never answers is looked for on Ethereum instead, and claimed once", async () => {
		const claim = vi.fn(async () => "claimed" as const)
		const f = await fakeEnv({ reconcileDeposit: async (d) => ticketFor(d), claim })
		f.l1.hangNextSend = true
		const flow = new DepositFlow(f.env)
		void flow.confirm({ amount: AMOUNT, kind: "private", recipient: f.account.toString() })
		await vi.waitFor(() => expect(flow.store.get().step).toBe("sending"))

		await flow.recheck()
		expect(flow.store.get()).toMatchObject({ step: "done", outcome: "claimed" })
		expect(claim).toHaveBeenCalledTimes(1)
		expect(f.l1.sends.filter((s) => s.functionName === "deposit")).toHaveLength(1)
	})

	it("pays the claim fee from the wallet only after the user accepts the fallback", async () => {
		const claim = vi.fn().mockRejectedValue(new SponsorUnavailableError("The fee sponsor could not pay."))
		const f = await fakeEnv({ claim })
		const flow = new DepositFlow(f.env)
		await flow.confirm({ amount: AMOUNT, kind: "private", recipient: f.account.toString() })
		expect(flow.store.get().step).toBe("fee-fallback")

		await flow.declineFeeFallback()
		expect(flow.store.get().step).toBe("claim-failed")
		await flow.retryClaim()
		expect(flow.store.get().step).toBe("fee-fallback")
		expect(claim.mock.calls.map((c) => c[4].fee)).toEqual([undefined, undefined])

		claim.mockResolvedValueOnce("claimed")
		await flow.acceptFeeFallback()
		expect(claim.mock.calls.at(-1)?.[4].fee).toBe("wallet-default")
		expect(flow.store.get()).toMatchObject({ step: "done", outcome: "claimed" })
	})

	it("names only the reviewed recipient: a wallet switched since the review signs nothing", async () => {
		const f = await fakeEnv()
		const flow = new DepositFlow(f.env)
		await flow.confirm({ amount: AMOUNT, kind: "private", recipient: (await AztecAddress.random()).toString() })
		expect(flow.store.get()).toMatchObject({ step: "idle", notice: expect.stringContaining("account changed") })
		expect(f.l1.signs).toHaveLength(0)
		expect(f.env.inFlight.size).toBe(0)
	})

	it("claims only from the account the deposit names: a switched wallet is asked to switch back, and nothing is lost", async () => {
		const claimable = deferred<void>()
		const claim = vi.fn().mockResolvedValue("claimed")
		const f = await fakeEnv({ waitClaimable: () => claimable.promise, claim })
		const flow = new DepositFlow(f.env)
		const running = flow.confirm({ amount: AMOUNT, kind: "private", recipient: f.account.toString() })
		await until(() => flow.store.get().step === "waiting")
		const own = f.env.l2
		const other = await AztecAddress.random()
		Object.assign(f.env, { l2: () => ({ ...own(), account: other }) })
		claimable.resolve()
		await running
		expect(flow.store.get()).toMatchObject({ step: "claim-failed", notice: expect.stringContaining("Switch your Aztec wallet back") })
		expect(claim).not.toHaveBeenCalled()
		expect(f.env.inFlight.size).toBe(1)

		Object.assign(f.env, { l2: own })
		await flow.retryClaim()
		expect(flow.store.get()).toMatchObject({ step: "done", outcome: "claimed" })
		expect(claim.mock.calls[0]?.[4].from.equals(f.account)).toBe(true)
	})

	it("holds an unclaimed deposit at the paused screen, then claims once the bridge resumes", async () => {
		const f = await fakeEnv()
		f.env.ops.waitClaimable = async () => {
			f.node.paused = true
		}
		const flow = new DepositFlow(f.env)
		await flow.confirm({ amount: AMOUNT, kind: "public", recipient: f.account.toString() })
		expect(flow.store.get()).toMatchObject({ step: "paused", notice: expect.stringContaining("paused") })
		expect(f.env.inFlight.size).toBe(1)

		f.node.paused = false
		f.env.ops.waitClaimable = async () => {}
		await flow.retryClaim()
		expect(flow.store.get()).toMatchObject({ step: "done", outcome: "claimed" })
	})
})
