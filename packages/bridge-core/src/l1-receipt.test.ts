import { describe, expect, it } from "bun:test"
import { awaitL1Receipt } from "./l1-receipt"

const HASH = "0xabc" as const
const RECEIPT = { status: "success" }
const noWait = () => Promise.resolve()
const timeout = async (): Promise<never> => {
	throw new Error("Timed out while waiting for transaction")
}

describe("awaitL1Receipt", () => {
	it("recovers a receipt mined despite the wait timing out", async () => {
		let waits = 0
		const r = await awaitL1Receipt(
			{
				waitForTransactionReceipt: async () => {
					waits++
					return timeout()
				},
				getTransactionReceipt: async () => RECEIPT,
			},
			HASH,
			{ waitMs: noWait },
		)
		expect(r).toBe(RECEIPT)
		expect(waits).toBe(1)
	})

	it("throws on a reverted receipt, whether waited for or probed", async () => {
		const reverted = async () => ({ status: "reverted" })
		await expect(
			awaitL1Receipt({ waitForTransactionReceipt: reverted, getTransactionReceipt: reverted }, HASH, { waitMs: noWait }),
		).rejects.toThrow(/reverted on-chain/)
		await expect(
			awaitL1Receipt({ waitForTransactionReceipt: timeout, getTransactionReceipt: reverted }, HASH, { waitMs: noWait }),
		).rejects.toThrow(/reverted on-chain/)
	})

	it("keeps waiting while unmined, narrating each round", async () => {
		const seen: number[] = []
		let round = 0
		const r = await awaitL1Receipt(
			{
				waitForTransactionReceipt: async () => (++round < 3 ? timeout() : RECEIPT),
				getTransactionReceipt: async () => {
					throw new Error("not found")
				},
			},
			HASH,
			{ waitMs: noWait, onStillWaiting: (a) => seen.push(a) },
		)
		expect(r).toBe(RECEIPT)
		expect(seen).toEqual([1, 2])
	})

	it("exhausted rounds throw a resumable message, never a bare timeout", async () => {
		await expect(
			awaitL1Receipt(
				{
					waitForTransactionReceipt: timeout,
					getTransactionReceipt: async () => {
						throw new Error("not found")
					},
				},
				HASH,
				{ attempts: 2, waitMs: noWait },
			),
		).rejects.toThrow(/deposit is kept.*without sending a new transaction/s)
	})
})
