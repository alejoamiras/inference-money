import { describe, expect, it } from "bun:test"
import {
	assertNetworkIdentity,
	type ClaimTicket,
	claim,
	confirmDeposit,
	isClaimConsumed,
	NetworkMismatchError,
	prepareDeposit,
	reconcileDeposit,
	submitDeposit,
	waitClaimFinalized,
} from "@inference-money/bridge-core"
import { type PublicClient, WaitForTransactionReceiptTimeoutError, type WalletClient } from "viem"
import { claimable, claimFor, deposit, depositsBy, l1Actor, l1Now, l2Actor, l2Balances, sentDuring, USDC, usdcOf } from "./actors"
import { harness, INTEGRATION } from "./harness"

describe.skipIf(!INTEGRATION)("deposits and claims", () => {
	it("[A1][A9] public deposit → claim_public: L1 escrows into the portal, L2 mints the public balance", async () => {
		const { manifest: m } = harness()
		const [l1, bob] = await Promise.all([l1Actor(), l2Actor()])
		const [portalBefore, actorBefore, l2Before] = await Promise.all([usdcOf(m.l1.portal), usdcOf(l1.account), l2Balances(bob)])
		const t = await deposit(l1, "public", bob, 5n * USDC)
		expect(await usdcOf(m.l1.portal)).toBe(portalBefore + 5n * USDC)
		expect(await usdcOf(l1.account)).toBe(actorBefore - 5n * USDC)
		await claimable(t, bob)
		expect(await claimFor(t)).toBe("claimed")
		expect(await l2Balances(bob)).toEqual({ public: l2Before.public + 5n * USDC, private: l2Before.private })
	})

	it("[A2][A15][A19] private deposit → claim_private, paid by the sponsor, then final: the submitted tx names it as fee payer", async () => {
		const { manifest: m } = harness()
		const [l1, bob] = await Promise.all([l1Actor(), l2Actor()])
		const t = await deposit(l1, "private", bob, 7n * USDC)
		await claimable(t, bob)
		const txs = await sentDuring(async () => expect(await claimFor(t)).toBe("claimed"))
		expect(txs.map((x) => x.feePayer)).toEqual([m.l2.sponsoredFpc as string])
		expect((await l2Balances(bob)).private).toBe(7n * USDC)
		expect(await waitClaimFinalized(t, harness().node, m, { pollMs: 2_000 }), "the node answers at the finalized tag").toBe("finalized")
	})

	it("[A2] a relayer's private claim for the wrong recipient fails to consume; the same relayer then lands the right one", async () => {
		const [l1, bob, relayer] = await Promise.all([l1Actor(), l2Actor(), l2Actor()])
		const t = await deposit(l1, "private", bob, 3n * USDC)
		await claimable(t, relayer)
		const redirected: ClaimTicket = { ...t, draft: { ...t.draft, intent: { ...t.draft.intent, recipient: relayer } } }
		await expect(claim(redirected, harness().node, harness().wallet, harness().manifest, { from: relayer })).rejects.toThrow()
		expect(await claim(t, harness().node, harness().wallet, harness().manifest, { from: relayer })).toBe("claimed")
		expect((await l2Balances(bob)).private).toBe(3n * USDC)
		expect((await l2Balances(relayer)).private).toBe(0n)
	})

	it("[A3] a second claim of the same deposit reports already-consumed, public and private, on its nullifier alone", async () => {
		const [l1, bob] = await Promise.all([l1Actor(), l2Actor()])
		const { node, manifest: m } = harness()
		for (const kind of ["public", "private"] as const) {
			const t = await deposit(l1, kind, bob, USDC)
			await claimable(t, bob)
			expect(await isClaimConsumed(t, node, m)).toBe(false)
			expect(await claimFor(t)).toBe("claimed")
			expect(await isClaimConsumed(t, node, m)).toBe(true)
			expect(await claimFor(t)).toBe("already-consumed")
		}
		expect(await l2Balances(bob)).toEqual({ public: USDC, private: USDC })
	})

	it("[A11] a receipt wait that times out is recovered by reconcileDeposit, and the claim lands with exactly one deposit", async () => {
		const { manifest: m } = harness()
		const [l1, bob] = await Promise.all([l1Actor(), l2Actor()])
		const d = await prepareDeposit({ amount: 2n * USDC, recipient: bob, kind: "public" }, m, await l1Now())
		const hash = await submitDeposit(d, l1, m, harness().node)
		const stalled = {
			...l1.publicClient,
			waitForTransactionReceipt: async () => {
				throw new WaitForTransactionReceiptTimeoutError({ hash })
			},
			getTransactionReceipt: async () => {
				throw new Error("receipt not found")
			},
		} as unknown as PublicClient
		await expect(confirmDeposit(d, { ...l1, publicClient: stalled }, m, undefined, { attempts: 1 })).rejects.toThrow()
		const t = await reconcileDeposit(d, l1, m)
		if (typeof t === "string") throw new Error(`reconcile returned ${t}`)
		await claimable(t, bob)
		expect(await claimFor(t)).toBe("claimed")
		expect(await depositsBy(l1.account)).toBe(1)
	})

	it("[A11] a wallet that broadcasts and then loses the response: the log scan finds the deposit, one deposit, claimed", async () => {
		const { manifest: m } = harness()
		const [l1, bob] = await Promise.all([l1Actor(), l2Actor()])
		const lossy = {
			...l1.walletClient,
			writeContract: async (args: Parameters<WalletClient["writeContract"]>[0]) => {
				await l1.publicClient.waitForTransactionReceipt({ hash: await l1.walletClient.writeContract(args) })
				throw new Error("wallet disconnected")
			},
		} as unknown as WalletClient
		const d = await prepareDeposit({ amount: 4n * USDC, recipient: bob, kind: "private" }, m, await l1Now())
		await expect(submitDeposit(d, { ...l1, walletClient: lossy }, m, harness().node)).rejects.toThrow("disconnected")
		expect([d.submission !== undefined, d.l1TxHash]).toEqual([true, undefined])
		const t = await reconcileDeposit(d, l1, m)
		if (typeof t === "string") throw new Error(`reconcile returned ${t}`)
		await claimable(t, bob)
		expect(await claimFor(t)).toBe("claimed")
		expect(await depositsBy(l1.account)).toBe(1)
		expect((await l2Balances(bob)).private).toBe(4n * USDC)
	})

	it("[A12] a network that is not the manifest's is refused before anything is signed", async () => {
		const { manifest: m, node, l1: chain } = harness()
		await assertNetworkIdentity(node, chain.publicClient, m)
		for (const wrong of [
			{ ...m, l2: { ...m.l2, rollupVersion: m.l2.rollupVersion + 1 } },
			{ ...m, l1: { ...m.l1, outbox: m.l1.inbox } },
		]) {
			await expect(assertNetworkIdentity(node, chain.publicClient, wrong)).rejects.toBeInstanceOf(NetworkMismatchError)
		}
		const [l1, bob] = await Promise.all([l1Actor(), l2Actor()])
		let signatures = 0
		const counting = {
			...l1.walletClient,
			signTypedData: (...args: Parameters<WalletClient["signTypedData"]>) => {
				signatures++
				return l1.walletClient.signTypedData(...args)
			},
		} as unknown as WalletClient
		const otherChain = { ...m, l1: { ...m.l1, chainId: 1 } }
		const d = await prepareDeposit({ amount: USDC, recipient: bob, kind: "public" }, otherChain, await l1Now())
		await expect(submitDeposit(d, { ...l1, walletClient: counting }, otherChain, node)).rejects.toBeInstanceOf(NetworkMismatchError)
		expect([signatures, d.submission]).toEqual([0, undefined])
	})
})
