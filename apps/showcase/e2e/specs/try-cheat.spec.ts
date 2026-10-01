import { BRIDGE_REFUSALS, TOKEN_REFUSALS } from "@inference-money/bridge-core/rules"
import { TESTIDS } from "../../src/lib/testids"
import { L1_SENDS, L2_SEND } from "../fixtures/rpc"
import { expect, test } from "../fixtures/test"
import { compose, feed, openLive, type Step, tryIt } from "../pages/live"

/** "Within seconds", with room for a cold CI runner's first simulation. */
const REFUSED_WITHIN_MS = 30_000

const CHEATS: [string, Step, string][] = [
	["alice pays her friend bob", { actor: "alice", action: "send", to: "bob", amount: "0.01" }, TOKEN_REFUSALS.transfer],
	[
		"alice cashes out to bob's Ethereum wallet",
		{ actor: "alice", action: "withdraw", to: "B_demo", amount: "0.01" },
		BRIDGE_REFUSALS.exitDestination,
	],
	["bob opens a payment request for alice", { actor: "bob", action: "request", to: "alice" }, TOKEN_REFUSALS.request],
	[
		"alice pays bob's request, which no merchant stamped",
		{ actor: "alice", action: "pay", to: "bob", amount: "0.01" },
		TOKEN_REFUSALS.payment,
	],
]

test("[A21][A22][A24] every cheat is refused while simulating, with the contract's own rule, and nothing reaches either chain", async ({
	page,
	me,
}) => {
	await openLive(page)
	for (const [name, step, rule] of CHEATS) {
		await test.step(name, async () => {
			const mark = me.rpc.calls.length
			await compose(page, step)
			const run = await tryIt(page)
			console.log(`[try-cheat] ${name}: ${run.kind} in ${run.ms} ms`)
			expect(run.kind, run.detail).toBe("refused")
			await expect(page.getByTestId(TESTIDS.verdictRule)).toHaveText(rule)
			expect(run.detail).toContain("Nothing was proven or sent.")
			expect(run.ms).toBeLessThan(REFUSED_WITHIN_MS)
			for (const method of [L2_SEND, ...L1_SENDS]) expect(me.rpc.countSince(mark, method), method).toBe(0)
		})
	}
	expect(await feed(page), "a refusal publishes nothing").toEqual([])
})
