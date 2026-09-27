import { TESTIDS } from "../../src/lib/testids"
import { expect, test } from "../fixtures/test"
import { connectAztec, grantedAccounts, openPickerWith, pickerRow, tid, walletFrame } from "../pages/connect"

// Two accounts make the `main` wallet ask for a choice; `solo` imports the first alone.
test.use({ cells: 2 })

test("discovery → emoji → grant → account: the chosen account is the active one", async ({ page, pool, run }) => {
	const [, second] = pool.all
	if (!second) throw new Error("the pool holds fewer than two actors")
	await page.goto("/")
	const row = pickerRow(page, "main")
	await openPickerWith(page, row)
	await row.locator(tid(TESTIDS.walletPickerConnect)).click()
	const grid = page.locator(tid(TESTIDS.verificationGrid)).locator("span")
	await expect(grid).toHaveCount(9)
	for (const cell of await grid.all()) await expect(cell).not.toBeEmpty()
	await page.locator(tid(TESTIDS.btnVerifyConfirm)).click()
	const chooser = page.locator(tid(TESTIDS.accountChoice))
	await expect(chooser.locator(tid(TESTIDS.accountChoiceRow))).toHaveCount(pool.all.length, { timeout: 120_000 })
	await chooser.locator(`${tid(TESTIDS.accountChoiceRow)}[data-address="${second.address}"]`).click()
	await chooser.locator(tid(TESTIDS.accountChoiceContinue)).click()
	await expect(page.locator(tid(TESTIDS.aztecStatus))).toHaveAttribute("data-status", "connected", { timeout: 120_000 })
	await expect(page.locator(tid(TESTIDS.accountChip))).toHaveAttribute("title", second.address)
	// The wallet lists accounts in its own order; the grant must carry exactly the seeded set.
	expect((await grantedAccounts(page)).sort()).toEqual(pool.all.map((a) => a.address).sort())
	// Registration ran through the enforcing wallet and stayed inside the grant.
	const wallet = walletFrame(page, run, "main")
	expect((await wallet.evaluate(() => window.__testWallet?.calls() ?? {})).registerContract).toBeGreaterThanOrEqual(3)
	expect(await wallet.evaluate(() => window.__testWallet?.denied() ?? ["no control surface"])).toEqual([])
})

test("a one-account wallet skips the chooser", async ({ page, pool }) => {
	const [first] = pool.all
	await page.goto("/")
	await connectAztec(page, { profile: "solo", refuseChooser: true })
	await expect(page.locator(tid(TESTIDS.accountChip))).toHaveAttribute("title", first?.address ?? "")
})

test("a wallet frame that answers 4 s late is still discovered", async ({ page }) => {
	await page.goto("/")
	await connectAztec(page, { profile: "late" })
})

test("both frames are cross-origin isolated", async ({ page, run }) => {
	await page.goto("/")
	expect(await page.evaluate(() => crossOriginIsolated)).toBe(true)
	await connectAztec(page, { profile: "main" })
	expect(await walletFrame(page, run, "main").evaluate(() => crossOriginIsolated)).toBe(true)
})

test("[A12] the L1 wallet connects through wagmi and the chain guard holds writes until it switches", async ({ page, l1 }) => {
	await page.goto("/")
	await page.locator(tid(TESTIDS.l1Connect)).click()
	const status = page.locator(tid(TESTIDS.l1Status))
	await expect(status).toHaveAttribute("data-status", "connected")
	await expect(status.locator(`[data-address="${l1.address}"]`)).toBeVisible()
	await l1.setChainId(1)
	await expect(status).toHaveAttribute("data-status", "wrong-chain")
	await page.locator(tid(TESTIDS.l1SwitchChain)).click()
	await expect(status).toHaveAttribute("data-status", "connected")
})
