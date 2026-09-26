import { describe, expect, it } from "bun:test"
import { BlockNumber } from "@aztec/foundation/branded-types"
import { depositStatus, type ProvenBlockSource, withdrawStatus } from "./status"

/** A node whose proven tip is `n`; any other tag would be the wrong tip. */
const provenAt = (n: number): ProvenBlockSource => ({
	getBlockNumber: async (tip) => {
		if (tip !== "proven") throw new Error(`read the ${tip} tip`)
		return BlockNumber(n)
	},
})

describe("status", () => {
	it("deposits are time-based", () => {
		const p = depositStatus(0, 240_000, 60_000)
		expect(p.fillFraction).toBeCloseTo(0.25, 5)
		expect(p.blocksRemaining).toBeUndefined()
	})

	it("withdrawals count proven blocks, and are done once proven reaches the exit's block", async () => {
		const mid = await withdrawStatus(provenAt(110), 120, 100)
		expect(mid.blocksRemaining).toBe(10)
		const done = await withdrawStatus(provenAt(120), 120, 100)
		expect(done.done).toBe(true)
	})
})
