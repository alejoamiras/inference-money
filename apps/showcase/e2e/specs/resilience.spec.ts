import { TESTIDS } from "../../src/lib/testids"
import { demoWallet, mintUsdc, transferUsdc, usdcOf } from "../fixtures/chain"
import { L1_SENDS, L2_SEND } from "../fixtures/rpc"
import { expect, test } from "../fixtures/test"
import { compose, expectBalance, feed, openLive, pickScene, resetBalances, shownBalance, tryIt, USDC } from "../pages/live"

// A payout waits for its epoch's proof on Ethereum.
test.describe.configure({ timeout: 30 * 60_000 })
const PAID_OUT_MS = 20 * 60_000
/** `demo setup`'s private seed for alice, which the reset restores. */
const ALICE_SEED = 10n * USDC
const CENT = USDC / 100n
const NOWHERE = "0x000000000000000000000000000000000000dEaD"

test("a send another visitor beat to the same funds retries once on the nullifier conflict, and settles", async ({ page, me, another }) => {
	const other = await another()
	await Promise.all([openLive(page), openLive(other.page)])
	const alice = await shownBalance(page, "alice")
	const step = { actor: "alice", action: "send", to: "galactica", amount: "0.01" }
	await compose(page, step)
	await compose(other.page, step)

	// This page's tx is built from the same note the other visitor is about to spend, and held at the node's door.
	const mark = me.rpc.calls.length
	const door = me.rpc.holdNext(L2_SEND)
	const mine = tryIt(page)
	await Promise.race([door.held, mine.then((r) => Promise.reject(new Error(`the run ended before sending: ${r.kind}, ${r.detail}`)))])
	const theirs = await tryIt(other.page)
	expect(theirs.kind, theirs.detail).toBe("settled")
	door.release()
	const run = await mine
	expect(run.kind, run.detail).toBe("settled")
	expect(me.rpc.countSince(mark, L2_SEND), "the refused send, then one retry").toBe(2)
	await expectBalance(page, "alice", alice - 2n * CENT)
})

test("[A13] a reload while a payout is on its way resumes it, and it pays out once", async ({ page, me, run, manifest }) => {
	const aDemo = demoWallet(manifest, "alice").address
	await openLive(page)
	const held = await usdcOf(run.anvilUrl, manifest, aDemo)

	// The page finds the proof and sends the payout; that request never leaves, and the page reloads under it.
	const door = me.rpc.holdNext("eth_sendRawTransaction")
	await pickScene(page, "withdraw")
	const exit = await tryIt(page)
	expect(exit.kind, exit.detail).toBe("settled")
	await door.held
	const mark = me.rpc.calls.length
	expect(await usdcOf(run.anvilUrl, manifest, aDemo), "nothing paid out before the reload").toBe(held)
	await openLive(page, true)
	door.release("abort")

	await expect.poll(() => usdcOf(run.anvilUrl, manifest, aDemo), { timeout: PAID_OUT_MS }).toBe(held + 3n * CENT)
	await expect(page.getByTestId(TESTIDS.payout)).toHaveCount(0)
	expect(me.rpc.countSince(mark, "eth_sendRawTransaction"), "paid once").toBe(1)
	expect((await feed(page)).at(0)).toMatchObject({ chain: "ethereum", source: "LIVE" })
})

test("Reset balances has galactica top alice back up to her starting balance", async ({ page }) => {
	await openLive(page)
	const [alice, galactica] = [await shownBalance(page, "alice"), await shownBalance(page, "galactica")]
	await compose(page, { actor: "alice", action: "send", to: "galactica", amount: "0.05" })
	expect((await tryIt(page)).kind).toBe("settled")
	await expectBalance(page, "galactica", galactica + 5n * CENT)

	const short = ALICE_SEED - (alice - 5n * CENT)
	const refund = short < galactica + 5n * CENT ? short : galactica + 5n * CENT
	const reset = await resetBalances(page)
	expect(reset.kind, reset.detail).toBe("settled")
	await expectBalance(page, "alice", alice - 5n * CENT + refund)
})

test("with the demo float empty, or nothing to claim, the page replays the recorded step and says so", async ({
	page,
	me,
	run,
	manifest,
}) => {
	const { key, address } = demoWallet(manifest, "alice")
	await openLive(page)

	await test.step("a claim with nothing pending", async () => {
		await pickScene(page, "claim")
		const r = await tryIt(page)
		expect(r.kind).toBe("settled")
		expect(r.detail).toContain("There is nothing to claim: deposit first. This replays the recorded run instead, so nothing moved now.")
		expect((await feed(page)).at(0)).toEqual({ step: "claim", chain: "aztec", source: "RECORDED" })
	})

	await test.step("a deposit from an empty Ethereum wallet", async () => {
		const float = await usdcOf(run.anvilUrl, manifest, address)
		await transferUsdc(run.anvilUrl, manifest, key, NOWHERE, float)
		try {
			const mark = me.rpc.calls.length
			await pickScene(page, "deposit")
			const r = await tryIt(page)
			expect(r.kind).toBe("settled")
			expect(r.detail).toContain("This Ethereum wallet holds 0.00 demo USDC, less than that. This replays the recorded run instead")
			expect((await feed(page)).at(0)).toEqual({ step: "deposit", chain: "ethereum", source: "RECORDED" })
			for (const method of [L2_SEND, ...L1_SENDS]) expect(me.rpc.countSince(mark, method), method).toBe(0)
		} finally {
			await mintUsdc(run.anvilUrl, manifest, key, float)
		}
	})
})
