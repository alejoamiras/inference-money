import { describe, expect, it } from "bun:test"
import { AztecAddress } from "@aztec-labs/aztec.js/addresses"
import { TxHash } from "@aztec-labs/aztec.js/tx"
import { getAddress } from "viem"
import { prepareDeposit } from "./deposit"
import { a, f, MANIFEST } from "./test/fixtures"
import { decodeClaimTicket, decodeDepositDraft, decodeExitTicket, encodeTicket } from "./ticket-codec"

describe("ticket codec", () => {
	it("round-trips a draft, a claim ticket and an exit ticket with their types", async () => {
		const recipient = await AztecAddress.random()
		const draft = await prepareDeposit({ amount: 5n, recipient, kind: "private" }, MANIFEST, () => 1_000n)
		draft.submission = { account: getAddress(a(0xd0)), chainId: 1, fromBlock: 9n, fromBlockHash: f(0x99) }
		expect(decodeDepositDraft(encodeTicket("draft", draft))).toEqual(draft)
		const claim = { draft, messageHash: f(0x77), leafIndex: 3n, depositor: getAddress(a(0xd0)) }
		const back = decodeClaimTicket(encodeTicket("claim", claim))
		expect(back).toEqual(claim)
		expect(back.draft.secretOrSalt.equals(draft.secretOrSalt)).toBe(true)
		expect(back.draft.intent.recipient.equals(recipient)).toBe(true)

		const exit = { l2TxHash: TxHash.random(), recipient: getAddress(a(0xe1)), amount: 3n, messageHash: f(9), messageIndexInTx: 1 }
		const exitBack = decodeExitTicket(encodeTicket("exit", exit))
		expect(exitBack.l2TxHash.equals(exit.l2TxHash)).toBe(true)
		expect(exitBack).toEqual(exit)
	})

	it("refuses another protocol version and the other kind", async () => {
		const exit = { l2TxHash: TxHash.random(), recipient: getAddress(a(0xe1)), amount: 3n, messageHash: f(9), messageIndexInTx: 0 }
		const stored = JSON.parse(encodeTicket("exit", exit))
		expect(() => decodeExitTicket(JSON.stringify({ ...stored, protocolVersion: 1 }))).toThrow("protocol 1 ticket")
		expect(() => decodeClaimTicket(encodeTicket("exit", exit))).toThrow("expected a claim ticket")
	})
})
