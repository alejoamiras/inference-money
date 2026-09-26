// @vitest-environment node
import { SponsorUnavailableError } from "@inference-money/bridge-core"
import { pad } from "viem"
import { describe, expect, it, vi } from "vitest"
import { DepositFlow } from "./deposit-flow"
import { fakeEnv, stepsOf } from "./test/fake-env"

const ZERO_WORD = pad("0x0")
const AMOUNT = 25_000_000n
const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)).toLowerCase()

describe("DepositFlow", () => {
	it("registers the draft before the signature, and a private deposit never names its recipient", async () => {
		const f = await fakeEnv()
		const flow = new DepositFlow(f.env)
		const steps = stepsOf(flow.store)
		f.l1.allowance = 0n
		f.l1.onSign = () => expect(f.env.inFlight.size).toBe(1)

		await flow.confirm({ amount: AMOUNT, kind: "private" })

		expect(steps).toEqual(["checking", "approving", "signing", "sending", "confirming", "waiting", "claiming", "done"])
		expect(flow.store.get()).toMatchObject({ outcome: "claimed", recipient: f.account.toString() })
		expect(f.env.inFlight.size).toBe(0)
		const [approve, deposit] = f.l1.sends
		expect(approve?.functionName).toBe("approve")
		expect(deposit?.args[1]).toBe(ZERO_WORD)
		expect(f.l1.signs[0]?.message).toMatchObject({ witness: { aztecRecipient: ZERO_WORD, isPrivate: true } })
		expect(json([f.l1.signs, deposit])).not.toContain(f.account.toString().slice(2))
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
		await flow.confirm({ amount: AMOUNT, kind: "public" })
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
		await flow.confirm({ amount: AMOUNT, kind: "public" })
		expect(f.l1.signs).toHaveLength(1)
		expect(f.l1.sends).toHaveLength(0)
		expect(flow.store.get()).toMatchObject({ step: "idle", notice: expect.stringContaining("paused") })
		expect(f.env.inFlight.size).toBe(0)
	})

	it("keeps a sent deposit through receipt trouble: re-checks never re-send, discard only once proven never deposited", async () => {
		const reconcile = vi.fn().mockResolvedValueOnce("pending").mockResolvedValueOnce("not-deposited")
		const f = await fakeEnv({ confirmDeposit: () => Promise.reject(new Error("timed out")), reconcileDeposit: reconcile })
		const flow = new DepositFlow(f.env)
		await flow.confirm({ amount: AMOUNT, kind: "public" })
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

	it("pays the claim fee from the wallet only after the user accepts the fallback", async () => {
		const claim = vi.fn().mockRejectedValue(new SponsorUnavailableError("The fee sponsor could not pay."))
		const f = await fakeEnv({ claim })
		const flow = new DepositFlow(f.env)
		await flow.confirm({ amount: AMOUNT, kind: "private" })
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

	it("holds an unclaimed deposit at the paused screen, then claims once the bridge resumes", async () => {
		const f = await fakeEnv()
		f.env.ops.waitClaimable = async () => {
			f.node.paused = true
		}
		const flow = new DepositFlow(f.env)
		await flow.confirm({ amount: AMOUNT, kind: "public" })
		expect(flow.store.get()).toMatchObject({ step: "paused", notice: expect.stringContaining("paused") })
		expect(f.env.inFlight.size).toBe(1)

		f.node.paused = false
		f.env.ops.waitClaimable = async () => {}
		await flow.retryClaim()
		expect(flow.store.get()).toMatchObject({ step: "done", outcome: "claimed" })
	})
})
