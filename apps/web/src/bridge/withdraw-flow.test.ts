// @vitest-environment node
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { TxHash } from "@aztec/aztec.js/tx"
import { ExitRevertedError, ExitUnconfirmedError, SponsorUnavailableError, StaleProofError } from "@inference-money/bridge-core"
import { zeroAddress } from "viem"
import { describe, expect, it, vi } from "vitest"
import { MANIFEST } from "@/config/network"
import { deferred, exitTicket, fakeEnv, L1_ACCOUNT, L1_TX, stepsOf } from "./test/fake-env"
import { NOT_FOUND, WithdrawFlow, withdrawLockName } from "./withdraw-flow"

const REQ = { kind: "private", amount: 5_000_000n, recipient: L1_ACCOUNT } as const
const until = async (cond: () => boolean) => {
	for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 0))
	expect(cond()).toBe(true)
}

describe("WithdrawFlow", () => {
	it.each([
		["the bridge portal", MANIFEST.l1.portal],
		["the deposit router", MANIFEST.l1.router],
		["the zero address", zeroAddress],
	])("refuses %s as the Ethereum recipient before reading anything", async (_, recipient) => {
		const l2Balance = vi.fn()
		const exitToL1 = vi.fn()
		const f = await fakeEnv({ l2Balance, exitToL1 })
		const flow = new WithdrawFlow(f.env)
		await flow.exit({ ...REQ, recipient, from: f.account.toString() })
		expect(flow.store.get()).toMatchObject({ step: "idle", notice: expect.stringContaining("could never be paid out") })
		expect(l2Balance).not.toHaveBeenCalled()
		expect(exitToL1).not.toHaveBeenCalled()
	})

	it("holds the tab lock until the withdrawal's receipt, so a second tab is told instead of submitting", async () => {
		const mined = deferred<`0x${string}`>()
		const withdrawOnL1 = vi.fn(() => mined.promise)
		const f = await fakeEnv({ withdrawOnL1 })
		const first = new WithdrawFlow(f.env)
		const steps = stepsOf(first.store)
		const running = first.exit({ ...REQ, from: f.account.toString() })
		await until(() => first.store.get().step === "withdrawing")

		// Hash returned, receipt not yet: the lock is still held.
		const name = withdrawLockName(exitTicket())
		expect(await f.env.locks.ifAvailable(name, async (held) => held)).toBe(false)
		const second = new WithdrawFlow(f.env)
		await second.finish({ l2TxHash: exitTicket().l2TxHash.toString(), recipient: L1_ACCOUNT, amount: REQ.amount })
		expect(second.store.get()).toMatchObject({ step: "other-tab", notice: expect.stringContaining("Another tab") })

		mined.resolve(L1_TX)
		await running
		expect(steps).toEqual(["checking", "exiting", "proving", "withdrawing", "done"])
		expect(first.store.get()).toMatchObject({ outcome: "withdrawn", l1TxHash: L1_TX })
		expect(withdrawOnL1).toHaveBeenCalledTimes(1)
		expect(await f.env.locks.ifAvailable(name, async (held) => held)).toBe(true)
		expect(f.env.inFlight.size).toBe(1) // the second tab's ticket, still its to retry
	})

	it("re-checks under the lock, so an exit another tab finished is never submitted again", async () => {
		const withdrawOnL1 = vi.fn()
		const f = await fakeEnv({ withdrawOnL1, isExitWithdrawn: async () => true })
		const flow = new WithdrawFlow(f.env)
		await flow.exit({ ...REQ, from: f.account.toString() })
		expect(flow.store.get()).toMatchObject({ step: "done", outcome: "already-withdrawn" })
		expect(withdrawOnL1).not.toHaveBeenCalled()
	})

	it("rebuilds a proof Ethereum rejects as stale, up to the limit", async () => {
		const withdrawOnL1 = vi.fn().mockRejectedValue(new StaleProofError())
		const waitWithdrawable = vi.fn(async () => ({}) as never)
		const f = await fakeEnv({ withdrawOnL1, waitWithdrawable })
		const flow = new WithdrawFlow(f.env)
		await flow.exit({ ...REQ, from: f.account.toString() })
		expect(flow.store.get()).toMatchObject({ step: "failed", notice: expect.stringContaining("kept") })
		expect(waitWithdrawable).toHaveBeenCalledTimes(3)

		withdrawOnL1.mockResolvedValueOnce(L1_TX)
		await flow.retry()
		expect(flow.store.get()).toMatchObject({ step: "done", outcome: "withdrawn" })
	})

	it("turns a burned but unlocated exit into a prefilled finish, and says plainly when nothing matches", async () => {
		const hash = TxHash.random()
		const exitTicketFromTx = vi.fn().mockResolvedValueOnce("not-found").mockResolvedValueOnce(exitTicket())
		const f = await fakeEnv({
			exitToL1: () => Promise.reject(new ExitUnconfirmedError(hash, L1_ACCOUNT, REQ.amount)),
			exitTicketFromTx,
		})
		const flow = new WithdrawFlow(f.env)
		await flow.exit({ ...REQ, from: f.account.toString() })
		const { recovery } = flow.store.get()
		expect(recovery).toEqual({ l2TxHash: hash.toString(), recipient: L1_ACCOUNT, amount: REQ.amount })
		if (!recovery) return

		await flow.finish({ ...recovery, amount: 1n })
		expect(flow.store.get()).toMatchObject({ step: "unconfirmed", notice: NOT_FOUND, recovery })
		await flow.finish(recovery)
		expect(flow.store.get()).toMatchObject({ step: "done", outcome: "withdrawn" })
		expect(exitTicketFromTx.mock.calls[1]?.slice(0, 3)).toEqual([hash, L1_ACCOUNT, REQ.amount])
	})

	it("keeps an exit whose send may have gone out for finishing from its hash, and never answers it with a fresh one", async () => {
		const declined = Object.assign(new Error("User rejected the request."), { code: 4001 })
		const exitToL1 = vi.fn().mockRejectedValueOnce(new Error("fetch failed")).mockRejectedValueOnce(declined)
		const f = await fakeEnv({ exitToL1 })
		const flow = new WithdrawFlow(f.env)
		const req = { ...REQ, from: f.account.toString() }
		await flow.exit(req)
		expect(flow.store.get()).toMatchObject({
			step: "unconfirmed",
			l2TxHash: null,
			recovery: { l2TxHash: "", recipient: L1_ACCOUNT, amount: REQ.amount },
			notice: expect.stringContaining("may still have sent"),
		})
		expect(f.env.inFlight.size, "the details stay guarded until the user closes them").toBe(1)
		await flow.exit(req)
		expect(exitToL1, "no fresh exit from the unconfirmed screen").toHaveBeenCalledTimes(1)

		await flow.reset()
		expect(f.env.inFlight.size).toBe(0)
		await flow.exit(req)
		expect(flow.store.get(), "a refusal sent nothing: back to the form").toMatchObject({
			step: "idle",
			notice: expect.stringContaining("declined"),
		})
		expect(f.env.inFlight.size).toBe(0)
	})

	it("returns a reverted exit to the form: it burned nothing, so there is nothing to finish", async () => {
		const exitToL1 = vi.fn().mockRejectedValue(new ExitRevertedError(TxHash.random()))
		const f = await fakeEnv({ exitToL1 })
		const flow = new WithdrawFlow(f.env)
		await flow.exit({ ...REQ, from: f.account.toString() })
		expect(flow.store.get()).toMatchObject({ step: "idle", notice: expect.stringContaining("nothing was burned") })
		expect(f.env.inFlight.size).toBe(0)
	})

	it("exits only from the reviewed account", async () => {
		const exitToL1 = vi.fn()
		const f = await fakeEnv({ exitToL1 })
		const flow = new WithdrawFlow(f.env)
		await flow.exit({ ...REQ, from: (await AztecAddress.random()).toString() })
		expect(flow.store.get()).toMatchObject({ step: "idle", notice: expect.stringContaining("account changed") })
		expect(exitToL1).not.toHaveBeenCalled()
	})

	it("burns with the wallet paying only after the user accepts the fee fallback", async () => {
		const exitToL1 = vi
			.fn()
			.mockRejectedValueOnce(new SponsorUnavailableError("The fee sponsor could not pay."))
			.mockResolvedValue(exitTicket())
		const f = await fakeEnv({ exitToL1 })
		const flow = new WithdrawFlow(f.env)
		await flow.exit({ ...REQ, from: f.account.toString() })
		expect(flow.store.get().step).toBe("fee-fallback")
		expect(exitToL1).toHaveBeenCalledTimes(1)
		await flow.acceptFeeFallback()
		expect(exitToL1.mock.calls[1]?.[4]).toEqual({ fee: "wallet-default" })
		expect(flow.store.get().step).toBe("done")
	})
})
