import { describe, expect, it } from "bun:test"
import type { AztecNode } from "@aztec-labs/aztec.js/node"
import type { Tx } from "@aztec-labs/aztec.js/tx"
import { recordingNode, type SentTx } from "./sent"

const tx = {
	getTxHash: () => ({ toString: () => "0x01" }),
	data: {
		feePayer: { toString: () => "0x02" },
		expirationTimestamp: 9n,
		constants: { anchorBlockHeader: { globalVariables: { timestamp: 1n } } },
	},
} as unknown as Tx

/** Sends through a node whose `sendTx` fails with `message`; the record it kept. */
async function refusedWith(message: string): Promise<SentTx | undefined> {
	const sent: SentTx[] = []
	const node = recordingNode({ sendTx: () => Promise.reject(new Error(message)) } as unknown as AztecNode, sent)
	await expect(node.sendTx(tx)).rejects.toThrow(message)
	return sent[0]
}

describe("recordingNode", () => {
	it("marks a send refused only when the node answered with a validation error, never on a lost response", async () => {
		expect((await refusedWith("Invalid tx: Existing nullifier"))?.refused).toBe(true)
		expect((await refusedWith("fetch failed"))?.refused).toBeUndefined()
	})

	it("journals before sending, and a journal that throws stops the send with nothing recorded", async () => {
		const order: string[] = []
		const sent: SentTx[] = []
		const node = { sendTx: async () => void order.push("send") } as unknown as AztecNode
		await recordingNode(node, sent, () => order.push("journal")).sendTx(tx)
		expect([order, sent.map((s) => s.hash)]).toEqual([["journal", "send"], ["0x01"]])
		const refusing = recordingNode(node, sent, () => {
			throw new Error("unsaved")
		})
		expect(() => refusing.sendTx(tx)).toThrow("unsaved")
		expect([order, sent.length]).toEqual([["journal", "send"], 1])
	})
})
