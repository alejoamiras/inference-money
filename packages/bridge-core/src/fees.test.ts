import { describe, expect, it } from "bun:test"
import { GasFees } from "@aztec-labs/stdlib/gas"
import { type MinFeeNode, predictedWorstMinFees } from "./fees"

const CURRENT = new GasFees(1n, 1n)
const node = (predict: MinFeeNode["getPredictedMinFees"]) => {
	const n = { currentReads: 0 }
	const fees: MinFeeNode = {
		getPredictedMinFees: predict,
		getCurrentMinFees: async () => {
			n.currentReads++
			return CURRENT
		},
	}
	return { n, fees }
}
const throws = (e: Error) => async (): Promise<GasFees[]> => {
	throw e
}

describe("predictedWorstMinFees", () => {
	it("takes the worst of each dimension independently across predicted slots", async () => {
		const { fees } = node(async () => [new GasFees(5n, 2n), new GasFees(3n, 9n)])
		expect(await predictedWorstMinFees(fees)).toEqual(new GasFees(5n, 9n))
	})

	it.each([
		["a missing method", undefined],
		["a JSON-RPC -32601", throws(Object.assign(new Error("rpc error"), { cause: { code: -32601 } }))],
		["a 'Method not found' message", throws(new Error("Method not found: node_getPredictedMinFees"))],
	])("falls back to the current min fee on %s", async (_, predict) => {
		const { n, fees } = node(predict)
		expect(await predictedWorstMinFees(fees)).toBe(CURRENT)
		expect(n.currentReads).toBe(1)
	})

	it("propagates a transient error rather than under-pricing the cap", async () => {
		const { n, fees } = node(throws(new Error("block not found")))
		await expect(predictedWorstMinFees(fees)).rejects.toThrow("block not found")
		expect(n.currentReads).toBe(0)
	})
})
