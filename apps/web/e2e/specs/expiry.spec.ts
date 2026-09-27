/**
 * Runs last, in its own project: it moves L1 time past the signed permit's deadline, which the local Aztec network
 * then has to catch up to. Nothing may share the network after it.
 */
import { TESTIDS } from "../../src/lib/testids"
import { depositsBy, mineL1Past } from "../fixtures/chain"
import { expect, test } from "../fixtures/test"
import { byId, openBridge, reviewDeposit, stepperAt, unloadGuarded } from "../pages/bridge"

test("[A11] the wallet never answers the deposit: nothing is found until its permit expires, then discard leaves nothing pending", async ({
	page,
	pool,
	l1,
	run,
	manifest,
}) => {
	await openBridge(page, pool.take())
	l1.holdNext("transaction", { to: manifest.l1.router })
	await reviewDeposit(page, { amount: "1", kind: "private" })
	await byId(page, TESTIDS.depositConfirm).click()
	await expect.poll(() => l1.holdsArmed(), { timeout: 120_000 }).toBe(0)
	await stepperAt(page, "Sent on Ethereum")
	expect(await unloadGuarded(page)).toBe(true)

	await byId(page, TESTIDS.depositRecheck).click()
	await expect(byId(page, TESTIDS.flowNotice)).toContainText("Not found on Ethereum yet")
	await expect(byId(page, TESTIDS.depositDiscard), "no discard while the permit could still land").toHaveCount(0)
	const signatures = l1.signatures
	const sends = l1.calls("eth_sendTransaction")
	const [permit] = l1.permits()
	expect(permit, "the deposit's one signed permit").toBeDefined()

	await mineL1Past(run.anvilUrl, permit?.deadline ?? 0n)
	await byId(page, TESTIDS.depositRecheck).click()
	await expect(byId(page, TESTIDS.flowNotice)).toContainText("never reached Ethereum")
	await byId(page, TESTIDS.depositDiscard).click()

	await expect(byId(page, TESTIDS.depositAmount)).toBeVisible()
	expect(await unloadGuarded(page)).toBe(false)
	expect(l1.signatures, "nothing signed after the wallet went quiet").toBe(signatures)
	expect(l1.calls("eth_sendTransaction"), "nothing sent after the wallet went quiet").toBe(sends)
	expect((await depositsBy(run.anvilUrl, manifest, l1.address)).filter((d) => d.nonce === permit?.nonce)).toHaveLength(0)
})
