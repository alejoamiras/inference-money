import { TESTIDS } from "../../src/lib/testids"
import { demoWallet, depositsBy, l2Receipt, type RunManifest, usdcOf } from "../fixtures/chain"
import { L2_SEND } from "../fixtures/rpc"
import { expect, test, type Visitor } from "../fixtures/test"
import { expectBalance, type FeedEntry, feed, newRows, openLive, pickScene, shownBalance, tryIt, USDC } from "../pages/live"

// A claim waits for its message to reach Aztec, a payout for its epoch's proof on Ethereum.
test.describe.configure({ timeout: 40 * 60_000 })
const PAID_OUT_MS = 20 * 60_000

interface Settled {
	rows: FeedEntry[]
	/** The Aztec txs the page sent while it ran, counted off the wire. */
	sent: number
}

/** Runs a scene's preset live; it must settle, publishing live rows only. */
async function settle({ page, rpc }: Visitor, scene: string): Promise<Settled> {
	const [before, mark] = [await feed(page), rpc.calls.length]
	await pickScene(page, scene)
	const run = await tryIt(page)
	console.log(`[try-happy] ${scene}: ${run.kind} in ${run.ms} ms`)
	expect(run.kind, run.detail).toBe("settled")
	const rows = await newRows(page, before)
	expect(
		rows.filter((r) => r.source !== "LIVE"),
		"a live run publishes live rows only",
	).toEqual([])
	return { rows, sent: rpc.countSince(mark, L2_SEND) }
}

/** Each of the `count` txs the page sent is one Aztec row, and the node holds it as executed. */
async function landedOnAztec(m: RunManifest, s: Settled, count: number): Promise<void> {
	const aztec = s.rows.filter((r) => r.chain === "aztec")
	expect([aztec.length, s.sent], "rows and sends").toEqual([count, count])
	for (const r of aztec) expect(await l2Receipt(m.l2.nodeUrl, r.step)).toMatchObject({ executionResult: "success" })
}

test("[A2][A5][A9][A23] deposit, claim, pay a session, refund and withdraw run live, and the withdrawal pays out on Ethereum", async ({
	page,
	me,
	run,
	manifest,
}) => {
	const aDemo = demoWallet(manifest, "alice").address
	const l1 = () => usdcOf(run.anvilUrl, manifest, aDemo)
	const escrow = () => usdcOf(run.anvilUrl, manifest, manifest.l1.portal)
	await openLive(page)
	const alice = await shownBalance(page, "alice")
	const galactica = await shownBalance(page, "galactica")

	await test.step("A_demo deposits 0.10 for alice", async () => {
		const [held, escrowed, deposits] = [await l1(), await escrow(), await depositsBy(run.anvilUrl, manifest, aDemo)]
		const mark = me.rpc.calls.length
		expect(await settle(me, "deposit")).toMatchObject({ rows: [{ chain: "ethereum" }], sent: 0 })
		expect(me.rpc.countSince(mark, "eth_sendRawTransaction"), "signed and sent from this page").toBeGreaterThanOrEqual(1)
		expect(await l1()).toBe(held - USDC / 10n)
		expect(await escrow()).toBe(escrowed + USDC / 10n)
		const mined = await depositsBy(run.anvilUrl, manifest, aDemo)
		expect(mined).toHaveLength(deposits.length + 1)
		expect(mined.at(-1)).toMatchObject({ amount: USDC / 10n, isPrivate: true })
	})

	await test.step("alice claims it", async () => {
		await landedOnAztec(manifest, await settle(me, "claim"), 1)
		await expectBalance(page, "alice", alice + USDC / 10n)
	})

	await test.step("alice pays a session into galactica's request", async () => {
		await landedOnAztec(manifest, await settle(me, "pay"), 2)
		await expectBalance(page, "galactica", galactica + USDC / 10n)
	})

	await test.step("galactica refunds alice 0.03", async () => {
		await landedOnAztec(manifest, await settle(me, "refund"), 1)
		await expectBalance(page, "alice", alice + (3n * USDC) / 100n)
		await expectBalance(page, "galactica", galactica + (7n * USDC) / 100n)
	})

	await test.step("alice withdraws 0.03 home, and the page pays it out once the proof is on Ethereum", async () => {
		const [held, escrowed, mark] = [await l1(), await escrow(), me.rpc.calls.length]
		await landedOnAztec(manifest, await settle(me, "withdraw"), 1)
		await expectBalance(page, "alice", alice)
		await expect.poll(l1, { message: "A_demo's USDC on Ethereum", timeout: PAID_OUT_MS }).toBe(held + (3n * USDC) / 100n)
		expect(await escrow()).toBe(escrowed - (3n * USDC) / 100n)
		await expect(page.getByTestId(TESTIDS.payout)).toHaveCount(0)
		expect((await feed(page)).at(0)).toMatchObject({ chain: "ethereum", source: "LIVE" })
		expect(me.rpc.countSince(mark, "eth_sendRawTransaction"), "the payout is the one Ethereum tx").toBe(1)
	})
})
