import { beforeAll, describe, expect, it } from "bun:test"
import type { AztecAddress } from "@aztec-labs/aztec.js/addresses"
import type { Fr } from "@aztec-labs/aztec.js/fields"
import { MerkleTreeId } from "@aztec-labs/stdlib/trees"
import {
	completionCount,
	isStamped,
	openRequest,
	PaymentRefusedError,
	payRequest,
	Side,
	sideCapsule,
	siloedRequestMarks,
	TOKEN_REFUSALS,
} from "@inference-money/bridge-core"
import { funded, l1Actor, l2Actor, l2Balances, sentDuring, USDC } from "./actors"
import { harness, INTEGRATION } from "./harness"
import { as, listMerchant, merchantList, sponsored, token, tokenAddress } from "./token"

const AMOUNT = USDC / 10n

const open = async (from: AztecAddress, to: AztecAddress, completer: AztecAddress) => {
	const { wallet, node } = harness()
	return openRequest(wallet, node, tokenAddress(), { from, to, completer }, { list: await merchantList(), fee: sponsored() })
}

const pay = async (from: AztecAddress, commitment: Fr, kind: "private" | "public" = "private") => {
	const { gate, wallet } = harness()
	const intent = { from, commitment, amount: AMOUNT, kind }
	return payRequest(gate, wallet, tokenAddress(), intent, { list: await merchantList(), fee: sponsored() })
}

/** A payment straight to the token, past payments.ts, with a capsule claiming `side`. */
const payDirectly = (from: AztecAddress, commitment: Fr, side: Side) =>
	token().methods.transfer_private_to_commitment!(from, commitment, AMOUNT, 0)
		.with({ capsules: [sideCapsule(tokenAddress(), side)] })
		.send(as(from))

const nullifierCount = async (txHash: { toString(): string }) => {
	const effect = await harness().node.getTxEffect(txHash as never)
	if (!effect) throw new Error(`no effect for ${txHash}`)
	return effect.data.nullifiers.length
}

describe.skipIf(!INTEGRATION)("payment requests", () => {
	let alice: AztecAddress
	let bob: AztecAddress
	let m1: AztecAddress

	beforeAll(async () => {
		const l1 = await l1Actor()
		;[alice, bob, m1] = await Promise.all([l2Actor(), l2Actor(), l2Actor()])
		await listMerchant(m1)
		await funded(l1, "private", alice, USDC)
		await funded(l1, "public", m1, USDC)
	}, 900_000)

	it("[A22] a merchant's request is stamped and a user pays it; one opened for a user is padded, with as many nullifiers, and refused", async () => {
		const { node } = harness()
		const stamped = await open(m1, m1, alice)
		expect(await isStamped(node, tokenAddress(), stamped.commitment)).toBe(true)
		await pay(alice, stamped.commitment)
		expect((await l2Balances(m1)).private).toBe(AMOUNT)

		const padded = await open(m1, bob, alice)
		const { pad } = await siloedRequestMarks(tokenAddress(), padded.commitment)
		const [padIndex] = await node.findLeavesIndexes("latest", MerkleTreeId.NULLIFIER_TREE, [pad])
		expect([await isStamped(node, tokenAddress(), padded.commitment), padIndex !== undefined]).toEqual([false, true])
		expect(await nullifierCount(padded.txHash)).toBe(await nullifierCount(stamped.txHash))

		const refused = await sentDuring(async () => {
			await expect(pay(alice, padded.commitment)).rejects.toThrow(TOKEN_REFUSALS.payment)
			// The token refuses it whichever side a capsule claims: the stamp is missing, and alice is no merchant.
			await expect(payDirectly(alice, padded.commitment, Side.First)).rejects.toThrow()
			await expect(payDirectly(alice, padded.commitment, Side.Second)).rejects.toThrow(/uninitialized PublicImmutable/)
		})
		expect(refused).toEqual([])
	})

	it("[A22] a second payment into one request lands on chain and never reaches the recipient, so payments.ts refuses to send it", async () => {
		const { node } = harness()
		const [aliceBefore, m1Before] = [(await l2Balances(alice)).private, (await l2Balances(m1)).private]
		const request = await open(m1, m1, alice)
		await pay(alice, request.commitment)
		await expect(pay(alice, request.commitment)).rejects.toBeInstanceOf(PaymentRefusedError)

		const { receipt } = await payDirectly(alice, request.commitment, Side.First)
		expect(receipt.hasExecutionSucceeded()).toBe(true)
		expect(await completionCount(node, tokenAddress(), request.commitment)).toBe(2)
		expect((await l2Balances(alice)).private).toBe(aliceBefore - 2n * AMOUNT)
		expect((await l2Balances(m1)).private, "the recipient discovers only the first completion").toBe(m1Before + AMOUNT)
	})

	it("[A22] a merchant pays a user's request from its public balance through payments.ts, once", async () => {
		const { node } = harness()
		const request = await open(m1, bob, m1)
		await pay(m1, request.commitment, "public")
		expect(await completionCount(node, tokenAddress(), request.commitment)).toBe(1)
		await expect(pay(m1, request.commitment, "public")).rejects.toBeInstanceOf(PaymentRefusedError)
		expect((await l2Balances(bob)).private).toBe(AMOUNT)
	})
})
