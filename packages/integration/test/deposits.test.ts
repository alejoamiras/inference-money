import { describe, expect, it } from "bun:test"
import {
	assertNetworkIdentity,
	assertPublicRecipient,
	type ClaimTicket,
	claim,
	confirmDeposit,
	isClaimConsumed,
	NetworkMismatchError,
	PublicDepositToUserError,
	prepareDeposit,
	reconcileDeposit,
	submitDeposit,
	waitClaimFinalized,
} from "@inference-money/bridge-core"
import { isAddressEqual, type PublicClient, WaitForTransactionReceiptTimeoutError, type WalletClient } from "viem"
import {
	claimable,
	claimFor,
	deposit,
	depositsBy,
	l1Actor,
	l1Now,
	l2Actor,
	l2Balances,
	merchantActor,
	openBooks,
	sentDuring,
	USDC,
	usdcOf,
} from "./actors"
import { harness, INTEGRATION } from "./harness"
import { merchantList } from "./token"

describe.skipIf(!INTEGRATION)("deposits and claims", () => {
	it("[A1][A9] public deposit → claim_public: L1 escrows into the portal, L2 mints the merchant's public balance", async () => {
		const { manifest: m } = harness()
		const [l1, shop, bob] = await Promise.all([l1Actor(), merchantActor(), l2Actor()])
		const books = await openBooks()
		const list = await merchantList()
		expect(() => assertPublicRecipient(list, bob), "a user is refused before any signature").toThrow(PublicDepositToUserError)
		assertPublicRecipient(list, shop)
		const [portalBefore, actorBefore] = await Promise.all([usdcOf(m.l1.portal), usdcOf(l1.account)])
		const t = books.deposit(await deposit(l1, "public", shop, 5n * USDC))
		expect(await usdcOf(m.l1.portal)).toBe(portalBefore + 5n * USDC)
		expect(await usdcOf(l1.account)).toBe(actorBefore - 5n * USDC)
		await claimable(t, shop)
		expect(await claimFor(t)).toBe("claimed")
		expect(await l2Balances(shop)).toEqual({ public: 5n * USDC, private: 0n })
		await books.settle()
	})

	it("[A2][A15][A19] private deposit → claim_private, paid by the sponsor, then final: the submitted tx names it as fee payer", async () => {
		const { manifest: m } = harness()
		const [l1, bob] = await Promise.all([l1Actor(), l2Actor()])
		const books = await openBooks()
		const t = books.deposit(await deposit(l1, "private", bob, 7n * USDC))
		await claimable(t, bob)
		const txs = await sentDuring(async () => expect(await claimFor(t)).toBe("claimed"))
		expect(txs.map((x) => x.feePayer)).toEqual([m.l2.sponsoredFpc as string])
		expect((await l2Balances(bob)).private).toBe(7n * USDC)
		expect(await waitClaimFinalized(t, harness().node, m, { pollMs: 2_000 }), "the node answers at the finalized tag").toBe("finalized")
		await books.settle()
	})

	it("[A2] only the recipient claims privately: a relayed claim is refused, a redirected one consumes nothing", async () => {
		const [l1, bob, relayer] = await Promise.all([l1Actor(), l2Actor(), l2Actor()])
		const t = await deposit(l1, "private", bob, 3n * USDC)
		await claimable(t, bob)
		const { node, wallet, manifest: m } = harness()
		await expect(claim(t, node, wallet, m, { from: relayer })).rejects.toThrow("Only the recipient can claim privately")
		const redirected: ClaimTicket = { ...t, draft: { ...t.draft, intent: { ...t.draft.intent, recipient: relayer } } }
		await expect(claim(redirected, node, wallet, m, { from: relayer })).rejects.toThrow(/No L1 to L2 message found/)
		expect(await claimFor(t)).toBe("claimed")
		expect((await l2Balances(bob)).private).toBe(3n * USDC)
		expect((await l2Balances(relayer)).private).toBe(0n)
	})

	it("[A26] a router deposit names its signer, and a claim naming another depositor consumes nothing", async () => {
		const [l1, bob, shop] = await Promise.all([l1Actor(), l2Actor(), merchantActor()])
		for (const [kind, to] of [
			["public", shop],
			["private", bob],
		] as const) {
			const t = await deposit(l1, kind, to, USDC)
			expect(isAddressEqual(t.depositor, l1.account), `${kind}: the ticket names the signer`).toBe(true)
			await claimable(t, to)
			const misnamed: ClaimTicket = { ...t, depositor: "0x000000000000000000000000000000000000dEaD" }
			await expect(claimFor(misnamed)).rejects.toThrow(/No L1 to L2 message found|nonexistent L1-to-L2 message/)
			expect(await claimFor(t), `${kind}: the signer's claim consumes the message`).toBe("claimed")
		}
		expect([(await l2Balances(shop)).public, (await l2Balances(bob)).private]).toEqual([USDC, USDC])
	})

	it("[A3] a second claim of the same deposit reports consumed-unknown, public and private, on its nullifier alone", async () => {
		const [l1, bob, shop] = await Promise.all([l1Actor(), l2Actor(), merchantActor()])
		const { node, manifest: m } = harness()
		for (const [kind, to] of [
			["public", shop],
			["private", bob],
		] as const) {
			const t = await deposit(l1, kind, to, USDC)
			await claimable(t, to)
			expect(await isClaimConsumed(t, node, m)).toBe(false)
			expect(await claimFor(t)).toBe("claimed")
			expect(await isClaimConsumed(t, node, m)).toBe(true)
			expect(await claimFor(t)).toBe("consumed-unknown")
		}
		expect([(await l2Balances(shop)).public, (await l2Balances(bob)).private]).toEqual([USDC, USDC])
	})

	it("[A11] a receipt wait that times out is recovered by reconcileDeposit, and the claim lands with exactly one deposit", async () => {
		const { manifest: m } = harness()
		const [l1, shop] = await Promise.all([l1Actor(), merchantActor()])
		const d = await prepareDeposit({ amount: 2n * USDC, recipient: shop, kind: "public" }, m, await l1Now())
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
		await claimable(t, shop)
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
