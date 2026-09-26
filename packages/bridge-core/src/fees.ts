import { GasFees, ManaUsageEstimate } from "@aztec/stdlib/gas"

export interface MinFeeNode {
	getPredictedMinFees?: (manaUsage?: ManaUsageEstimate) => Promise<GasFees[]>
	getCurrentMinFees: () => Promise<GasFees>
}

/**
 * The highest min fee per gas dimension across the node's predicted slots: the inclusion-safe `maxFeesPerGas` for a tx
 * proven now and mined minutes later, when the current min fee may have risen. Falls back to the current min fee only
 * on a node that does not implement the prediction; any other error propagates, since under-pricing gets the tx rejected.
 */
export async function predictedWorstMinFees(node: MinFeeNode): Promise<GasFees> {
	if (!node.getPredictedMinFees) return node.getCurrentMinFees()
	let predicted: GasFees[]
	try {
		// An argless call estimates at target congestion, which under-prices a cap meant to survive rising load.
		predicted = await node.getPredictedMinFees(ManaUsageEstimate.Limit)
	} catch (e) {
		// Aztec's JSON-RPC reports an unknown method as -32601 "Method not found"; "block not found" is transient.
		const code = (e as { cause?: { code?: unknown } } | null)?.cause?.code
		if (code === -32601 || /method not found/i.test(e instanceof Error ? e.message : String(e))) return node.getCurrentMinFees()
		throw e
	}
	if (predicted.length === 0) return node.getCurrentMinFees()
	// Per dimension, so the bound holds even when DA and L2 fees peak in different slots.
	let da = 0n
	let l2 = 0n
	for (const f of predicted) {
		if (f.feePerDaGas > da) da = f.feePerDaGas
		if (f.feePerL2Gas > l2) l2 = f.feePerL2Gas
	}
	return new GasFees(da, l2)
}
