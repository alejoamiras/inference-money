import { describe, expect, it } from "bun:test"
import type { AztecNode } from "@aztec-labs/aztec.js/node"
import { TxStatus } from "@aztec-labs/aztec.js/tx"
import { fateOf, type Journaled } from "./smoke"

const MINED = [TxStatus.PROPOSED, TxStatus.CHECKPOINTED, TxStatus.PROVEN, TxStatus.FINALIZED]

/** A node whose receipt for every tx is `status`, and whose finalized block has timestamp `finalized`. */
const nodeWith = (status: TxStatus, reverted: boolean, finalized: bigint) =>
	({
		getTxReceipt: async () => ({
			status,
			isMined: () => MINED.includes(status),
			isPending: () => status === TxStatus.PENDING,
			isDropped: () => status === TxStatus.DROPPED,
			hasExecutionSucceeded: () => !reverted,
			hasExecutionReverted: () => reverted,
		}),
		getBlockData: async () => ({ header: { globalVariables: { timestamp: finalized } } }),
	}) as unknown as AztecNode

const PAY: Journaled = { step: "pay", hash: `0x${"11".repeat(32)}`, feePayer: `0x${"22".repeat(32)}`, expiresAt: "1000" }

describe("the smoke journal", () => {
	it("sends a step again only once finalized blocks prove its tx can never land, and fails while they cannot tell", async () => {
		expect(await fateOf(nodeWith(TxStatus.DROPPED, false, 1001n), PAY)).toBe("gone")
		await expect(fateOf(nodeWith(TxStatus.DROPPED, false, 1000n), PAY)).rejects.toThrow("may still land until 1970-01-01T00:16:40")
		expect(await fateOf(nodeWith(TxStatus.FINALIZED, true, 0n), PAY)).toBe("gone")
		await expect(fateOf(nodeWith(TxStatus.CHECKPOINTED, true, 0n), PAY)).rejects.toThrow("rerun once it is finalized")
		expect(await fateOf(nodeWith(TxStatus.CHECKPOINTED, false, 0n), PAY)).toBe("landed")
	})

	it("reads the finalized boundary before the receipt, so a tx the node takes in between is never called gone", async () => {
		let finalized = 1000n
		const node = nodeWith(TxStatus.DROPPED, false, 0n)
		const syncing = {
			getTxReceipt: async (h: unknown) => {
				const stale = await node.getTxReceipt(h as never)
				finalized = 2000n
				return stale
			},
			getBlockData: async () => ({ header: { globalVariables: { timestamp: finalized } } }),
		} as unknown as AztecNode
		await expect(fateOf(syncing, PAY)).rejects.toThrow("may still land")
	})
})
