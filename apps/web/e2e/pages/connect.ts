/** The connect flows, driven by test id only. */
import { expect, type Frame, type Locator, type Page } from "@playwright/test"
import { TESTIDS } from "../../src/lib/testids"
import type { RunEnv } from "../env"
import { type TestWalletProfile, walletIdOf } from "../test-wallet/profile"

export const tid = (t: string) => `[data-testid="${t}"]`

export interface ConnectOptions {
	profile: TestWalletProfile
	/** The account to pick when the grant lists several; defaults to the first row. */
	account?: string
	/** The chooser must not appear; if it does, the test fails rather than answering it. */
	refuseChooser?: boolean
}

export const pickerRow = (page: Page, profile: TestWalletProfile): Locator =>
	page.locator(`${tid(TESTIDS.walletPickerRow)}[data-wallet-id="${walletIdOf(profile)}"]`)

/**
 * Opens the picker until it lists the wanted wallet. Discovery probes every listed wallet URL in parallel with a 10 s
 * budget each; the reopen is the safety net for a frame that missed its budget.
 */
export async function openPickerWith(page: Page, row: Locator): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		await page.locator(tid(TESTIDS.aztecConnect)).click()
		try {
			await expect(row).toBeVisible({ timeout: 15_000 })
			return
		} catch (e) {
			if (attempt >= 2) throw e
			await page.locator(tid(TESTIDS.walletPickerCancel)).click()
			await expect(page.locator(tid(TESTIDS.walletPicker))).toBeHidden()
		}
	}
}

/** Picker → emoji check → grant → account choice → connected. */
export async function connectAztec(page: Page, o: ConnectOptions): Promise<void> {
	const row = pickerRow(page, o.profile)
	await openPickerWith(page, row)
	await row.locator(tid(TESTIDS.walletPickerConnect)).click()
	await expect(page.locator(tid(TESTIDS.verificationModal))).toBeVisible()
	await page.locator(tid(TESTIDS.btnVerifyConfirm)).click()
	await chooseAccountIfAsked(page, o)
	await expect(page.locator(tid(TESTIDS.aztecStatus))).toHaveAttribute("data-status", "connected", { timeout: 120_000 })
}

export async function chooseAccountIfAsked(page: Page, o: ConnectOptions): Promise<void> {
	const modal = page.locator(tid(TESTIDS.accountChoice))
	const connected = page.locator(`${tid(TESTIDS.aztecStatus)}[data-status="connected"]`)
	await Promise.race([modal.waitFor({ state: "visible", timeout: 120_000 }), connected.waitFor({ state: "attached", timeout: 120_000 })])
	if (!(await modal.isVisible())) return
	if (o.refuseChooser) throw new Error("the account chooser appeared on a connection that should not have asked")
	const row = o.account
		? modal.locator(`${tid(TESTIDS.accountChoiceRow)}[data-address="${o.account}"]`)
		: modal.locator(tid(TESTIDS.accountChoiceRow)).first()
	await row.click()
	await modal.locator(tid(TESTIDS.accountChoiceContinue)).click()
}

/** The session frame of a connected profile: the one whose `window.__testWallet` drives the wallet the app talks to. */
export function walletFrame(page: Page, run: Pick<RunEnv, "walletOrigins">, profile: TestWalletProfile): Frame {
	const origin = run.walletOrigins[profile]
	const frame = page
		.frames()
		.filter((f) => f.url().startsWith(`${origin}/`) && f.url().includes(`profile=${profile}`))
		.at(-1)
	if (!frame) throw new Error(`no session frame for the ${profile} wallet`)
	return frame
}

/** Every address the grant carried, as the account menu lists them. */
export async function grantedAccounts(page: Page): Promise<string[]> {
	await page.locator(tid(TESTIDS.accountChip)).click()
	const rows = page.locator(tid(TESTIDS.accountMenuRow))
	await expect(rows.first()).toBeVisible()
	const addresses = await rows.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.address ?? ""))
	await page.keyboard.press("Escape")
	return addresses
}
