import { describe, expect, it } from "bun:test"
import { depositStatus, withdrawStatus } from "./status"

describe("status", () => {
	it("deposits are time-based", () => {
		const p = depositStatus(0, 240_000, 60_000)
		expect(p.fillFraction).toBeCloseTo(0.25, 5)
		expect(p.blocksRemaining).toBeUndefined()
	})

	it("withdrawals count proven blocks, and are done once proven reaches the exit's block", async () => {
		const mid = await withdrawStatus({ getProvenBlockNumber: async () => 110 }, 120, 100)
		expect(mid.blocksRemaining).toBe(10)
		const done = await withdrawStatus({ getProvenBlockNumber: async () => 120n }, 120, 100)
		expect(done.done).toBe(true)
	})
})
