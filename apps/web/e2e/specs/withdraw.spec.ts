import { TESTIDS } from "../../src/lib/testids"
import { exitPublic, fundPublic, usdcOf } from "../fixtures/chain"
import { expect, test } from "../fixtures/test"
import { byId, connectL1, finishWithdrawal, openBridge, reviewDeposit, reviewWithdrawal, stepperAt, USDC } from "../pages/bridge"
import { walletFrame } from "../pages/connect"

// A public exit is paid by the actor's own wallet, so the actors hold Fee Juice.
test.use({ cells: 4, feeJuice: true })
// An exit is withdrawable once its epoch is proven on L1: minutes on the local network.
test.describe.configure({ timeout: 25 * 60_000 })
const PROVEN = 15 * 60_000

const lower = (v: unknown) => String(v).toLowerCase()

test("[A4] public exit → proven → withdrawn to the connected Ethereum account", async ({ page, pool, l1, run, manifest }) => {
	const actor = pool.take()
	await fundPublic(run.sidecarUrl, actor.address, 5n * USDC)
	await openBridge(page, actor)
	const before = await usdcOf(run.anvilUrl, manifest, l1.address)

	await reviewWithdrawal(page, { amount: "5", kind: "public" })
	await expect(byId(page, TESTIDS.withdrawSummary)).toContainText(l1.address)
	await byId(page, TESTIDS.withdrawConfirm).click()
	await stepperAt(page, "done", PROVEN)

	expect(await usdcOf(run.anvilUrl, manifest, l1.address)).toBe(before + 5n * USDC)
	expect(l1.transactionsTo(manifest.l1.portal)).toBe(1)
})

test("[A5][A15] private deposit, then a private exit the sponsor pays, withdrawn on Ethereum", async ({
	page,
	pool,
	l1,
	run,
	manifest,
}) => {
	const actor = pool.take()
	await openBridge(page, actor)
	await reviewDeposit(page, { amount: "4", kind: "private" })
	await byId(page, TESTIDS.depositConfirm).click()
	await stepperAt(page, "done")
	await byId(page, TESTIDS.depositReset).click()
	const before = await usdcOf(run.anvilUrl, manifest, l1.address)

	await reviewWithdrawal(page, { amount: "4", kind: "private" })
	await byId(page, TESTIDS.withdrawConfirm).click()
	await stepperAt(page, "done", PROVEN)
	await expect(byId(page, TESTIDS.withdrawTxHash)).toHaveText(/^0x[0-9a-f]{64}$/)

	expect(await usdcOf(run.anvilUrl, manifest, l1.address)).toBe(before + 4n * USDC)
	const submitted = await walletFrame(page, run, "main").evaluate(() => window.__testWallet?.submitted() ?? [])
	expect(submitted, "the claim and the exit").toHaveLength(2)
	for (const tx of submitted) expect(lower(tx.feePayer)).toBe(lower(manifest.l2.sponsoredFpc))
})

test("[A14] a withdrawal finishes from its Aztec tx hash, recipient and amount alone, with no Aztec wallet", async ({
	page,
	pool,
	l1,
	run,
	manifest,
}) => {
	const actor = pool.take()
	await fundPublic(run.sidecarUrl, actor.address, 2n * USDC)
	const txHash = await exitPublic(run.sidecarUrl, actor.address, 2n * USDC, l1.address)
	await page.goto("/")
	await connectL1(page)
	const before = await usdcOf(run.anvilUrl, manifest, l1.address)

	await finishWithdrawal(page, { txHash, recipient: l1.address, amount: "2.5" })
	await expect(byId(page, TESTIDS.flowNotice)).toContainText("No withdrawal matching these details")
	await finishWithdrawal(page, { txHash, recipient: l1.address, amount: "2" })
	await stepperAt(page, "done", PROVEN)

	expect(await usdcOf(run.anvilUrl, manifest, l1.address)).toBe(before + 2n * USDC)
})

test("[A13] two tabs finish the same exit: one Ethereum withdrawal, and the other tab is told", async ({
	context,
	page,
	pool,
	l1,
	run,
	manifest,
}) => {
	const actor = pool.take()
	await fundPublic(run.sidecarUrl, actor.address, USDC)
	const txHash = await exitPublic(run.sidecarUrl, actor.address, USDC, l1.address)
	const second = await context.newPage()
	for (const p of [page, second]) {
		await p.goto("/")
		await connectL1(p)
	}
	const details = { txHash, recipient: l1.address, amount: "1" }

	// The first tab's withdraw sits in the wallet prompt, inside its lock.
	l1.holdNext("transaction", { to: manifest.l1.portal })
	await finishWithdrawal(page, details)
	await stepperAt(page, "Withdraw on Ethereum", PROVEN)
	await expect.poll(() => l1.holdsArmed(), { timeout: 120_000 }).toBe(0)

	await finishWithdrawal(second, details)
	await expect(byId(second, TESTIDS.flowNotice)).toContainText("Another tab is finishing this withdrawal", { timeout: PROVEN })

	await l1.release()
	await stepperAt(page, "done")
	await byId(second, TESTIDS.withdrawRetry).click()
	await stepperAt(second, "done")
	await expect(second.getByText("This withdrawal was already completed on Ethereum.")).toBeVisible()
	expect(l1.transactionsTo(manifest.l1.portal), "exactly one withdraw left either tab").toBe(1)
})
