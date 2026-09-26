import { beforeAll, describe, expect, it } from "bun:test"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Fr } from "@aztec/aztec.js/fields"
import { getAddress, zeroAddress } from "viem"
import { type ExitIntent, type ExitNode, ExitUnconfirmedError, exitTicketFromTx, exitToL1, expectedExitMessage } from "./exit"
import { fakeEpoch } from "./test/fake-epoch"
import { fakeWallet } from "./test/fake-wallet"
import { a, MANIFEST as M } from "./test/fixtures"

const RECIPIENT = getAddress(a(0xe1))
const AMOUNT = 7_000_000n
let from: AztecAddress
let message: Fr

beforeAll(async () => {
	from = await AztecAddress.random()
	message = await expectedExitMessage(RECIPIENT, AMOUNT, M)
})

const intent = (o: Partial<ExitIntent> = {}): ExitIntent => ({ kind: "private", from, recipientL1: RECIPIENT, amount: AMOUNT, ...o })
const effectNode = (l2ToL1Msgs: Fr[]) => ({ getTxEffect: async () => ({ data: { l2ToL1Msgs } }) }) as unknown as ExitNode

describe("exitToL1", () => {
	it.each([
		["zero", zeroAddress],
		["portal", M.l1.portal],
		["router", M.l1.router],
	])("refuses a %s recipient before any wallet call", async (_, recipientL1) => {
		const w = fakeWallet()
		await expect(exitToL1(intent({ recipientL1 }), w.wallet, effectNode([message]), M)).rejects.toThrow(/could never be paid out/)
		expect(w.sent.length + w.authWits.length).toBe(0)
	})

	it("burns privately through the proxy with a sponsored witness exit, and locates its message among several", async () => {
		const w = fakeWallet()
		const t = await exitToL1(intent(), w.wallet, effectNode([new Fr(1), message]), M)
		expect(w.authWits).toEqual([{ from: from.toString(), caller: M.l2.proxy.address }])
		expect(w.sent[0]).toMatchObject({
			calls: ["sponsor_unconditionally", "exit_to_l1_private"],
			feePayer: M.l2.sponsoredFpc,
			authWitnesses: 1,
		})
		expect(t).toMatchObject({
			l2TxHash: w.txHash,
			recipient: RECIPIENT,
			amount: AMOUNT,
			messageHash: message.toString(),
			messageIndexInTx: 1,
		})
	})

	it("authorizes a public burn in the same batch as the exit, paid by the wallet unless sponsorship is chosen", async () => {
		const w = fakeWallet()
		await exitToL1(intent({ kind: "public" }), w.wallet, effectNode([message]), M)
		expect(w.authWits).toHaveLength(0)
		expect(w.sent[0]).toMatchObject({ calls: ["set_authorized", "exit_to_l1_public"], feePayer: undefined })
		const sponsored = fakeWallet()
		await exitToL1(intent({ kind: "public" }), sponsored.wallet, effectNode([message]), M, { fee: "sponsored" })
		expect(sponsored.sent[0]).toMatchObject({ feePayer: M.l2.sponsoredFpc })
	})

	it.each([
		["no matching messages", () => effectNode([new Fr(1)]), /without exactly one matching/],
		["two matching messages", () => effectNode([message, message]), /without exactly one matching/],
		["a node read that fails", () => ({ getTxEffect: () => Promise.reject(new Error("503")) }) as unknown as ExitNode, /503/],
	])("after the burn, %s still yields its hash for recovery", async (_, node, cause) => {
		const w = fakeWallet()
		const err = await exitToL1(intent(), w.wallet, node(), M).catch((e: unknown) => e)
		expect(err).toBeInstanceOf(ExitUnconfirmedError)
		expect(err).toMatchObject({ l2TxHash: w.txHash, recipient: RECIPIENT, amount: AMOUNT })
		expect(((err as Error).cause as Error).message).toMatch(cause)
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
