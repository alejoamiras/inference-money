/** The bridge flows, driven by test id only. */
import { expect, type Locator, type Page } from "@playwright/test"
import { TESTIDS } from "../../src/lib/testids"
import type { Actor } from "../fixtures/actors"
import { connectAztec, tid } from "./connect"

export const USDC = 1_000_000n

export const byId = (page: Page, id: string): Locator => page.locator(tid(id))

/** A choice from a `Choices` group, by its value. */
export const choose = (page: Page, group: string, value: string) => byId(page, group).locator(`[data-choice="${value}"]`).click()

/** Connected either way: wagmi reconnects a tab on its own when another tab of the same context already connected. */
export async function connectL1(page: Page): Promise<void> {
	const status = byId(page, TESTIDS.l1Status)
	await expect(async () => {
		if ((await status.getAttribute("data-status")) === "disconnected") await byId(page, TESTIDS.l1Connect).click({ timeout: 5_000 })
		await expect(status).toHaveAttribute("data-status", "connected", { timeout: 5_000 })
	}).toPass({ timeout: 60_000 })
}

/** Both wallets, the Aztec one on `actor`'s account. */
export async function openBridge(page: Page, actor: Actor): Promise<void> {
	await page.goto("/")
	await connectL1(page)
	await connectAztec(page, { profile: "main", account: actor.address })
	await expect(byId(page, TESTIDS.accountChip)).toHaveAttribute("title", actor.address)
}

/** The deposit form through its review; the confirm is the caller's, so it can arm faults first. */
export async function reviewDeposit(page: Page, o: { amount: string; kind: "public" | "private" }): Promise<void> {
	await choose(page, TESTIDS.direction, "deposit")
	await byId(page, TESTIDS.depositAmount).fill(o.amount)
	await choose(page, TESTIDS.depositKind, o.kind)
	await byId(page, TESTIDS.depositReview).click()
	await expect(byId(page, TESTIDS.depositSummary)).toContainText(`${o.amount} USDC`)
}

export async function reviewWithdrawal(page: Page, o: { amount: string; kind: "public" | "private"; recipient?: string }) {
	await choose(page, TESTIDS.direction, "withdraw")
	await choose(page, TESTIDS.withdrawMode, "new")
	await choose(page, TESTIDS.withdrawKind, o.kind)
	await byId(page, TESTIDS.withdrawAmount).fill(o.amount)
	if (o.recipient) await byId(page, TESTIDS.withdrawRecipient).fill(o.recipient)
	await byId(page, TESTIDS.withdrawReview).click()
	await expect(byId(page, TESTIDS.withdrawSummary)).toContainText(`${o.amount} USDC`)
}

export async function finishWithdrawal(page: Page, o: { txHash: string; recipient: string; amount: string }) {
	await choose(page, TESTIDS.direction, "withdraw")
	await choose(page, TESTIDS.withdrawMode, "finish")
	await byId(page, TESTIDS.finishTxHash).fill(o.txHash)
	await byId(page, TESTIDS.finishRecipient).fill(o.recipient)
	await byId(page, TESTIDS.finishAmount).fill(o.amount)
	await byId(page, TESTIDS.finishSubmit).click()
}

/** Waits for the flow's stepper to reach a step label, or "done". */
export const stepperAt = (page: Page, current: string, timeout = 5 * 60_000) =>
	expect(byId(page, TESTIDS.stepper)).toHaveAttribute("data-current", current, { timeout })

/** Whether leaving the page right now would be stopped by the app's unload guard. */
export const unloadGuarded = (page: Page) =>
	page.evaluate(() => {
		const e = new Event("beforeunload", { cancelable: true })
		window.dispatchEvent(e)
		return e.defaultPrevented
	})

/** The balance the app shows, in base units, once it has one. */
export async function shownBalance(page: Page, id: string): Promise<bigint> {
	const el = byId(page, id)
	await expect(el).toHaveAttribute("data-value", /\d+/)
	return BigInt((await el.getAttribute("data-value")) ?? "0")
}
