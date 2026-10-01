import { expect, test } from "../fixtures/test"
import { CHEATS, expectRefused } from "../pages/cheats"
import { feed, openLive } from "../pages/live"

test("[A21][A22][A24] every cheat is refused while simulating, with the contract's own rule, and nothing reaches either chain", async ({
	page,
	me,
}) => {
	await openLive(page)
	for (const cheat of CHEATS) await test.step(cheat[0], () => expectRefused(page, me.rpc, cheat))
	expect(await feed(page), "a refusal publishes nothing").toEqual([])
})
