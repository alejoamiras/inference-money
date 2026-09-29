import { TESTIDS } from "../../src/lib/testids"
import { depositsBy } from "../fixtures/chain"
import { expect, test } from "../fixtures/test"
import { byId, connectL1, openBridge, reviewDeposit, stepperAt, unloadGuarded } from "../pages/bridge"
import { openPickerWith, pickerRow, tid, walletFrame } from "../pages/connect"

test.use({ cells: 4 })

/** The envelope a wallet extension throws; the iframe transport encodes its message once more on the way out. */
const NOT_REGISTERED = JSON.stringify({ message: "Contract not registered", data: { walletErrorCode: "CONTRACT_NOT_REGISTERED" } })

test("[A11] an Ethereum signature refusal returns to the form with the reason, sends nothing, and the retry completes", async ({
	page,
	pool,
	l1,
	manifest,
}) => {
	await openBridge(page, pool.take())
	l1.rejectNext("signature")
	await reviewDeposit(page, { amount: "1", kind: "private" })
	await byId(page, TESTIDS.depositConfirm).click()
	await expect(byId(page, TESTIDS.flowNotice)).toContainText("You declined the request in your wallet.")
	expect(l1.transactionsTo(manifest.l1.router)).toBe(0)
	expect(await unloadGuarded(page), "a refused draft is dropped, not kept").toBe(false)

	await reviewDeposit(page, { amount: "1", kind: "private" })
	await byId(page, TESTIDS.depositConfirm).click()
	await stepperAt(page, "done")
	expect(l1.permits()).toHaveLength(1)
	expect(l1.transactionsTo(manifest.l1.router)).toBe(1)
})

test("[A12] a confirm-time read that fails signs nothing and says why", async ({ page, pool, l1, manifest }) => {
	await openBridge(page, pool.take())
	const node = new URL(manifest.l2.nodeUrl).origin
	// The node client retries a 503, so every fee read fails until the client gives up.
	let failed = 0
	await page.route(
		(url) => url.origin === node,
		async (route) => {
			if (route.request().postData()?.includes("getPredictedMinFees")) {
				failed++
				await route.fulfill({ status: 503, body: "unavailable" })
			} else await route.fallback()
		},
	)
	await reviewDeposit(page, { amount: "1", kind: "private" })
	await byId(page, TESTIDS.depositConfirm).click()
	await expect(byId(page, TESTIDS.flowNotice)).toBeVisible()
	expect(failed, "the fee read was the one that failed").toBeGreaterThan(0)
	expect(l1.signatures, "no approval, permit or transaction").toBe(0)
	expect(l1.transactionsTo(manifest.l1.router)).toBe(0)
	await expect(byId(page, TESTIDS.depositAmount)).toBeVisible()
})

test("[A11] the wallet sends the deposit but never returns its hash: the page finds it on Ethereum and claims once", async ({
	page,
	pool,
	l1,
	run,
	manifest,
}) => {
	await openBridge(page, pool.take())
	l1.swallowNext({ to: manifest.l1.router })
	await reviewDeposit(page, { amount: "2", kind: "private" })
	await byId(page, TESTIDS.depositConfirm).click()
	await expect.poll(() => l1.holdsArmed(), { timeout: 120_000 }).toBe(0)
	await stepperAt(page, "Sent on Ethereum")

	await byId(page, TESTIDS.depositRecheck).click()
	await stepperAt(page, "done")
	expect(l1.transactionsTo(manifest.l1.router), "found, never sent again").toBe(1)
	const [permit] = l1.permits()
	expect((await depositsBy(run.anvilUrl, manifest, l1.address)).filter((d) => d.nonce === permit?.nonce)).toHaveLength(1)
})

test("[A17] CONTRACT_NOT_REGISTERED from the wallet re-registers once and retries, with nothing for the user to do", async ({
	page,
	pool,
	run,
}) => {
	await openBridge(page, pool.take())
	const wallet = walletFrame(page, run, "main")
	const registered = (await wallet.evaluate(() => window.__testWallet?.calls().registerContract)) ?? 0
	await wallet.evaluate((message) => window.__testWallet?.failNext("simulateTx", "claim_private", message), NOT_REGISTERED)

	await reviewDeposit(page, { amount: "1", kind: "private" })
	await byId(page, TESTIDS.depositConfirm).click()
	await stepperAt(page, "done")
	await expect(byId(page, TESTIDS.flowNotice)).toHaveCount(0)
	await expect(byId(page, TESTIDS.aztecError)).toHaveCount(0)
	const after = (await wallet.evaluate(() => window.__testWallet?.calls().registerContract)) ?? 0
	expect(after - registered, "every app contract registered exactly once more").toBe(registered)
})

test("[A16] a grant that withholds the bridge's contracts is refused by the app before any call, and it says why", async ({
	page,
	l1,
	run,
}) => {
	await page.goto("/")
	await connectL1(page)
	const row = pickerRow(page, "main")
	await openPickerWith(page, row)
	await row.locator(tid(TESTIDS.walletPickerConnect)).click()
	await expect(page.locator(tid(TESTIDS.verificationModal))).toBeVisible()
	// The session frame exists once the channel is up; the grant comes after the emoji check.
	await walletFrame(page, run, "main").evaluate(() => window.__testWallet?.declineNextGrant())
	await page.locator(tid(TESTIDS.btnVerifyConfirm)).click()

	await expect(byId(page, TESTIDS.aztecError)).toContainText("Your wallet declined the permissions USDC Bridge needs", {
		timeout: 120_000,
	})
	await expect(page.locator(tid(TESTIDS.accountChoice)), "refused before an account is even offered").toHaveCount(0)
	const wallet = walletFrame(page, run, "main")
	expect(await wallet.evaluate(() => window.__testWallet?.denied() ?? []), "nothing outside the grant was attempted").toEqual([])
	expect(await wallet.evaluate(() => window.__testWallet?.calls().registerContract ?? 0)).toBe(0)
	await expect(byId(page, TESTIDS.bridgeGate)).toBeVisible()
	expect(l1.signatures).toBe(0)
})
