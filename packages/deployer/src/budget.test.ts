import { describe, expect, it } from "bun:test"
import { feeBudget } from "./budget"

describe("feeBudget", () => {
	it("charges every tx its estimated gas at the worst fee of each dimension, independently", () => {
		const budget = feeBudget({
			txCount: 2,
			gasPerTx: { daGas: 10, l2Gas: 100 },
			predicted: [
				{ feePerDaGas: 5n, feePerL2Gas: 1n },
				{ feePerDaGas: 1n, feePerL2Gas: 3n },
			],
			headroom: 3n,
		})
		expect(budget).toBe((10n * 5n + 100n * 3n) * 2n * 3n)
	})

	it("refuses to bound a budget with no fee prediction", () => {
		expect(() => feeBudget({ txCount: 1, gasPerTx: { daGas: 1, l2Gas: 1 }, predicted: [], headroom: 1n })).toThrow(/no predicted fees/)
	})
})
