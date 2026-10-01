import { beforeAll, describe, expect, it } from "bun:test"
import { AztecAddress } from "@aztec-labs/aztec.js/addresses"
import { Fr } from "@aztec-labs/aztec.js/fields"
import { TxStatus } from "@aztec-labs/aztec.js/tx"
import { getAddress } from "viem"
import { type ClaimTicket, prepareDeposit } from "./deposit"
import { type ExitNode, expectedExitMessage } from "./exit"
import { ReturnRevertedError, ReturnUnconfirmedError, returnDeposit } from "./return"
import { fakeWallet } from "./test/fake-wallet"
import { a, f, MANIFEST as M, receiptAt } from "./test/fixtures"

const DEPOSITOR = getAddress(a(0xd0d0))
const AMOUNT = 5n
let recipient: AztecAddress
let payout: Fr

beforeAll(async () => {
	recipient = await AztecAddress.random()
	payout = await expectedExitMessage(DEPOSITOR, AMOUNT, M)
})

const ticket = async (kind: "public" | "private"): Promise<ClaimTicket> => ({
	draft: await prepareDeposit({ amount: AMOUNT, recipient, kind }, M, () => 1_000n),
	messageHash: f(0x77),
	leafIndex: 3n,
	depositor: DEPOSITOR,
})
const CHECKPOINTED = receiptAt(TxStatus.CHECKPOINTED)
const REVERTED = { ...CHECKPOINTED, hasExecutionReverted: () => true }
const effectNode = (l2ToL1Msgs: Fr[], receipt: () => Promise<unknown> = async () => CHECKPOINTED) =>
	({ getTxEffect: async () => ({ data: { l2ToL1Msgs } }), getTxReceipt: receipt }) as unknown as ExitNode

describe("returnDeposit", () => {
	it("returns a private deposit through the sponsor and locates the withdrawal to its depositor", async () => {
		const w = fakeWallet()
		const t = await returnDeposit(await ticket("private"), w.wallet, effectNode([new Fr(1), payout]), M, { from: recipient })
		expect(w.sent[0]).toMatchObject({ calls: ["sponsor_unconditionally", "return_deposit_private"], feePayer: M.l2.sponsoredFpc })
		expect(t).toMatchObject({ l2TxHash: w.txHash, recipient: DEPOSITOR, amount: AMOUNT, messageIndexInTx: 1 })
	})

	it("reads a revert without the withdrawal as untouched, and any later failure as unconfirmed with its hash", async () => {
		const pub = await ticket("public")
		const w = fakeWallet()
		await expect(
			returnDeposit(
				pub,
				w.wallet,
				effectNode([], async () => REVERTED),
				M,
				{ from: recipient },
			),
		).rejects.toBeInstanceOf(ReturnRevertedError)
		expect(w.sent[0]).toMatchObject({ calls: ["return_deposit_public"], feePayer: undefined })

		const unreadable = effectNode([payout], () => Promise.reject(new Error("503")))
		const lost = await returnDeposit(pub, w.wallet, unreadable, M, { from: recipient }).catch((e: unknown) => e)
		expect(lost).toBeInstanceOf(ReturnUnconfirmedError)
		expect(lost).toMatchObject({ l2TxHash: w.txHash, depositor: DEPOSITOR, amount: AMOUNT })
	})
})
