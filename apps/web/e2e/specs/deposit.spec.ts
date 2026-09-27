import { pad } from "viem"
import { TESTIDS } from "../../src/lib/testids"
import { depositsBy, l2BalanceOf, l2Receipt, usdcOf } from "../fixtures/chain"
import { expect, test } from "../fixtures/test"
import { byId, openBridge, reviewDeposit, shownBalance, stepperAt, USDC, unloadGuarded } from "../pages/bridge"
import { walletFrame } from "../pages/connect"

// A public claim is paid by the actor's own wallet, so the actors hold Fee Juice.
test.use({ cells: 2, feeJuice: true })

const lower = (v: unknown) => String(v).toLowerCase()

test.describe("at 1024 px", () => {
	test.use({ viewport: { width: 1024, height: 900 } })

	test("[A1][A8] public deposit → claim: exact amounts on both chains, and the one signed permit binds the calldata", async ({
		page,
		pool,
		l1,
		run,
		manifest,
	}) => {
		const actor = pool.take()
		await openBridge(page, actor)
		const l1Before = await usdcOf(run.anvilUrl, manifest, l1.address)
		const l2Before = await shownBalance(page, TESTIDS.balanceL2Public)

		await reviewDeposit(page, { amount: "12.5", kind: "public" })
		await byId(page, TESTIDS.depositConfirm).click()
		await stepperAt(page, "done")
		await expect(page.getByText("Done. 12.5 USDC is in your public balance on Aztec.")).toBeVisible()

		expect(await usdcOf(run.anvilUrl, manifest, l1.address)).toBe(l1Before - 12_500_000n)
		await expect.poll(() => shownBalance(page, TESTIDS.balanceL2Public), { timeout: 120_000 }).toBe(l2Before + 12_500_000n)

		const [permit, ...extra] = l1.permits()
		expect(extra, "exactly one Permit2 signature").toEqual([])
		if (!permit) throw new Error("no permit was signed")
		const mined = (await depositsBy(run.anvilUrl, manifest, l1.address)).filter((d) => d.nonce === permit.nonce)
		expect(mined).toHaveLength(1)
		const [d] = mined
		expect(lower(permit.spender)).toBe(lower(manifest.l1.router))
		expect(lower(permit.permitted.token)).toBe(lower(manifest.l1.usdc))
		expect(permit.permitted.amount).toBe(12_500_000n)
		expect(d).toMatchObject({ amount: 12_500_000n, deadline: permit.deadline, isPrivate: false })
		expect(lower(permit.witness.aztecRecipient)).toBe(lower(d?.aztecRecipient))
		expect(lower(permit.witness.secretHash)).toBe(lower(d?.secretHash))
		expect(lower(d?.aztecRecipient), "a public deposit names its recipient").toBe(lower(actor.address))
	})
})

test.describe("at 390 px", () => {
	test.use({ viewport: { width: 390, height: 844 } })

	test("[A2][A15][A19] private deposit → claim: nothing names the recipient on Ethereum, and the sponsor pays the claim", async ({
		page,
		pool,
		l1,
		run,
		manifest,
	}) => {
		const actor = pool.take()
		await openBridge(page, actor)
		const before = await shownBalance(page, TESTIDS.balanceL2Private)
		const heldBefore = await l2BalanceOf(run.sidecarUrl, actor.address, "private")

		await reviewDeposit(page, { amount: "3", kind: "private" })
		await byId(page, TESTIDS.depositConfirm).click()
		await stepperAt(page, "Ready on Aztec")
		expect(await unloadGuarded(page), "an unclaimed deposit guards the tab").toBe(true)
		await stepperAt(page, "done")
		expect(await unloadGuarded(page)).toBe(false)
		await expect.poll(() => shownBalance(page, TESTIDS.balanceL2Private), { timeout: 120_000 }).toBe(before + 3n * USDC)
		// Read by a wallet the app never touched: the notes are the actor's, not only what the page shows.
		await expect.poll(() => l2BalanceOf(run.sidecarUrl, actor.address, "private"), { timeout: 120_000 }).toBe(heldBefore + 3n * USDC)

		const submitted = await walletFrame(page, run, "main").evaluate(() => window.__testWallet?.submitted() ?? [])
		expect(submitted, "the claim is the only tx this wallet sent").toHaveLength(1)
		expect(lower(submitted[0]?.feePayer)).toBe(lower(manifest.l2.sponsoredFpc))
		// The node's own record, not the wallet's: "done" waits for the claim to be proven, and it did not revert.
		expect(await l2Receipt(manifest.l2.nodeUrl, submitted[0]?.hash ?? "")).toMatchObject({
			status: expect.stringMatching(/^(proven|finalized)$/),
			executionResult: "success",
		})

		const [permit] = l1.permits()
		const [d] = (await depositsBy(run.anvilUrl, manifest, l1.address)).filter((x) => x.nonce === permit?.nonce)
		expect(d).toMatchObject({ isPrivate: true, aztecRecipient: pad("0x0") })
	})
})
