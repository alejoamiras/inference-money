import { beforeAll, describe, expect, it } from "bun:test"
import { AztecAddress } from "@aztec-labs/aztec.js/addresses"
import { NO_WAIT } from "@aztec-labs/aztec.js/contracts"
import { Fr } from "@aztec-labs/aztec.js/fields"
import { TxStatus } from "@aztec-labs/aztec.js/tx"
import { getAddress, zeroAddress } from "viem"
import { ExitDestinationError } from "./binding"
import { SponsorUnavailableError } from "./claim"
import {
	type ExitIntent,
	type ExitNode,
	ExitRevertedError,
	ExitUnconfirmedError,
	exitTicketFromTx,
	exitToL1,
	expectedExitMessage,
	isExitWithdrawn,
} from "./exit"
import { fakeEpoch } from "./test/fake-epoch"
import { fakeWallet } from "./test/fake-wallet"
import { a, MANIFEST as M, receiptAt } from "./test/fixtures"

const RECIPIENT = getAddress(a(0xe1))
const AMOUNT = 7_000_000n
let from: AztecAddress
let message: Fr

beforeAll(async () => {
	from = await AztecAddress.random()
	message = await expectedExitMessage(RECIPIENT, AMOUNT, M)
})

/** A wallet whose account is bound to RECIPIENT, the funding address every user exit here goes to. */
const boundWallet = (hooks: Parameters<typeof fakeWallet>[0] = {}) => fakeWallet({ utility: () => [new Fr(BigInt(RECIPIENT))], ...hooks })
const intent = (o: Partial<ExitIntent> = {}): ExitIntent => ({ kind: "private", from, recipientL1: RECIPIENT, amount: AMOUNT, ...o })
const CHECKPOINTED = receiptAt(TxStatus.CHECKPOINTED)
const REVERTED = { ...CHECKPOINTED, executionResult: "reverted", hasExecutionSucceeded: () => false, hasExecutionReverted: () => true }
const effectNode = (l2ToL1Msgs: Fr[], receipt: () => Promise<unknown> = async () => CHECKPOINTED) =>
	({ getTxEffect: async () => ({ data: { l2ToL1Msgs } }), getTxReceipt: receipt }) as unknown as ExitNode

describe("exitToL1", () => {
	it.each([
		["zero", zeroAddress],
		["portal", M.l1.portal],
		["router", M.l1.router],
	])("refuses a %s recipient before any wallet call", async (_, recipientL1) => {
		const w = boundWallet()
		await expect(exitToL1(intent({ recipientL1 }), w.wallet, effectNode([message]), M)).rejects.toThrow(/could never be paid out/)
		expect(w.sent.length + w.authWits.length).toBe(0)
	})

	it("burns privately through the proxy with a sponsored witness exit, and locates its message among several", async () => {
		const w = boundWallet()
		const t = await exitToL1(intent(), w.wallet, effectNode([new Fr(1), message]), M)
		expect(w.authWits).toEqual([{ from: from.toString(), caller: M.l2.proxy.address }])
		expect(w.sent[0]).toMatchObject({
			calls: ["sponsor_unconditionally", "exit_to_l1_private"],
			feePayer: M.l2.sponsoredFpc,
			authWitnesses: 1,
			wait: NO_WAIT,
		})
		expect(w.sent[0]?.args[1]?.at(-1)).toBe(0n)
		expect(t).toMatchObject({
			l2TxHash: w.txHash,
			recipient: RECIPIENT,
			amount: AMOUNT,
			messageHash: message.toString(),
			messageIndexInTx: 1,
		})
	})

	it("flags a merchant's private exit, which the bridge then checks against the merchant list", async () => {
		const w = boundWallet()
		await exitToL1(intent({ asMerchant: true }), w.wallet, effectNode([message]), M)
		expect(w.sent[0]?.args[1]?.at(-1)).toBe(1n)
	})

	it("refuses a user's private exit anywhere but its funding address before any witness or burn", async () => {
		for (const w of [fakeWallet(), fakeWallet({ utility: () => [new Fr(0xbeefn)] })]) {
			await expect(exitToL1(intent(), w.wallet, effectNode([message]), M)).rejects.toBeInstanceOf(ExitDestinationError)
			expect(w.sent.length + w.authWits.length).toBe(0)
		}
		const merchant = fakeWallet()
		await exitToL1(intent({ asMerchant: true }), merchant.wallet, effectNode([message]), M)
		expect(merchant.sent).toHaveLength(1)
	})

	it("authorizes a public burn in the same batch as the exit, paid by the wallet unless sponsorship is chosen", async () => {
		const w = boundWallet()
		await exitToL1(intent({ kind: "public" }), w.wallet, effectNode([message]), M)
		expect(w.authWits).toHaveLength(0)
		expect(w.sent[0]).toMatchObject({ calls: ["set_authorized", "exit_to_l1_public"], feePayer: undefined })
		const sponsored = boundWallet()
		await exitToL1(intent({ kind: "public" }), sponsored.wallet, effectNode([message]), M, { fee: "sponsored" })
		expect(sponsored.sent[0]).toMatchObject({ feePayer: M.l2.sponsoredFpc })
	})

	it("surfaces a sponsor that cannot pay as SponsorUnavailableError, with nothing burned", async () => {
		const w = boundWallet({
			send: () => {
				throw new Error("Not enough balance for fee payer to pay for transaction")
			},
		})
		await expect(exitToL1(intent(), w.wallet, effectNode([message]), M)).rejects.toBeInstanceOf(SponsorUnavailableError)
		const unsponsored = boundWallet({
			send: () => {
				throw new Error("Not enough balance for fee payer to pay for transaction")
			},
		})
		await expect(exitToL1(intent({ kind: "public" }), unsponsored.wallet, effectNode([message]), M)).rejects.not.toBeInstanceOf(
			SponsorUnavailableError,
		)
	})

	it.each([
		["no matching messages", () => effectNode([new Fr(1)]), /without exactly one matching/],
		["two matching messages", () => effectNode([message, message]), /without exactly one matching/],
		[
			"a node read that fails",
			() => ({ getTxReceipt: async () => CHECKPOINTED, getTxEffect: () => Promise.reject(new Error("503")) }) as unknown as ExitNode,
			/503/,
		],
		["a checkpoint wait that fails", () => effectNode([message], () => Promise.reject(new Error("receipt 503"))), /receipt 503/],
	])("after the burn, %s still yields its hash for recovery", async (_, node, cause) => {
		const w = boundWallet()
		const err = await exitToL1(intent(), w.wallet, node(), M).catch((e: unknown) => e)
		expect(err).toBeInstanceOf(ExitUnconfirmedError)
		expect(err).toMatchObject({ l2TxHash: w.txHash, recipient: RECIPIENT, amount: AMOUNT })
		expect(((err as Error).cause as Error).message).toMatch(cause)
	})

	it("hands the burn's hash to onSent before the wait, and one that throws still yields the hash for recovery", async () => {
		const w = boundWallet()
		const seen: string[] = []
		const wait = () => {
			seen.push("wait")
			return Promise.resolve(CHECKPOINTED)
		}
		await exitToL1(intent(), w.wallet, effectNode([message], wait), M, { onSent: (h) => seen.push(h.toString()) })
		expect(seen.slice(0, 2)).toEqual([w.txHash.toString(), "wait"])
		const failing = () => {
			throw new Error("quota")
		}
		const err = await exitToL1(intent(), boundWallet().wallet, effectNode([message]), M, { onSent: failing }).catch((e: unknown) => e)
		expect(err).toBeInstanceOf(ExitUnconfirmedError)
	})

	it("reads a revert whose effect carries no withdraw message as nothing burned", async () => {
		const err = await exitToL1(
			intent(),
			boundWallet().wallet,
			effectNode([], async () => REVERTED),
			M,
		).catch((e: unknown) => e)
		expect(err).toBeInstanceOf(ExitRevertedError)
		expect((err as ExitRevertedError).message).toMatch(/nothing was burned/)

		const noEffect = { getTxEffect: async () => undefined, getTxReceipt: async () => REVERTED } as unknown as ExitNode
		const unread = await exitToL1(intent(), boundWallet().wallet, noEffect, M).catch((e: unknown) => e)
		expect(unread, "a revert without a readable effect proves nothing").toBeInstanceOf(ExitUnconfirmedError)
	})
})

describe("exitTicketFromTx", () => {
	it("takes the first unconsumed of identical occurrences, and reports when all are consumed", async () => {
		const e = fakeEpoch([message, message])
		e.state.consumed.add(0)
		expect(await exitTicketFromTx(e.txHash, RECIPIENT, AMOUNT, e.node, e.outbox, M)).toMatchObject({ messageIndexInTx: 1 })
		e.state.consumed.add(1)
		expect(await exitTicketFromTx(e.txHash, RECIPIENT, AMOUNT, e.node, e.outbox, M)).toBe("all-consumed")
	})

	it("never mistakes a different recipient, amount or occurrence for this exit", async () => {
		const e = fakeEpoch([message])
		expect(await exitTicketFromTx(e.txHash, RECIPIENT, AMOUNT + 1n, e.node, e.outbox, M)).toBe("not-found")
		expect(await exitTicketFromTx(e.txHash, getAddress(a(0xe2)), AMOUNT, e.node, e.outbox, M)).toBe("not-found")
		expect(await exitTicketFromTx(e.txHash, RECIPIENT, AMOUNT, e.node, e.outbox, M, 1)).toBe("not-found")
		expect(await exitTicketFromTx(e.txHash, RECIPIENT, AMOUNT, e.node, e.outbox, M, 0)).toMatchObject({ messageIndexInTx: 0 })
	})

	it("treats an unproven epoch as not consumed", async () => {
		const e = fakeEpoch([message])
		e.state.outboxRoot = ["unproven"]
		expect(await exitTicketFromTx(e.txHash, RECIPIENT, AMOUNT, e.node, e.outbox, M)).toMatchObject({ messageIndexInTx: 0 })
	})
})

describe("isExitWithdrawn", () => {
	it("reads one occurrence's consumed bit, and false while its epoch is unproven", async () => {
		const e = fakeEpoch([message, message])
		const t = await exitTicketFromTx(e.txHash, RECIPIENT, AMOUNT, e.node, e.outbox, M, 1)
		if (typeof t === "string") throw new Error(t)
		e.state.consumed.add(0)
		expect(await isExitWithdrawn(t, e.node, e.outbox)).toBe(false)
		e.state.consumed.add(1)
		expect(await isExitWithdrawn(t, e.node, e.outbox)).toBe(true)
		e.state.outboxRoot = ["unproven"]
		expect(await isExitWithdrawn(t, e.node, e.outbox)).toBe(false)
	})
})
