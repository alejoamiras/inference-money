export interface Gas {
	daGas: number
	l2Gas: number
}

export interface FeesPerGas {
	feePerDaGas: bigint
	feePerL2Gas: bigint
}

/** The L2 txs a testnet deploy + smoke sends. */
export const TESTNET_DEPLOY_AND_SMOKE_TXS = [
	"deploy deployer account",
	"deploy smoke recipient account",
	"deploy token_minter_proxy",
	"deploy Token",
	"deploy token_bridge",
	"proxy.set_token",
	"proxy.set_bridge",
	"claim_public",
	"claim_private",
	"set public burn authwit",
	"exit_to_l1_public",
	"exit_to_l1_private",
] as const

/**
 * Per-tx gas estimate. Testnet txs sampled 2026-09-25 paid ≤ 2.02 FJ at p90 with 2.02e12 FJ per L2 gas
 * (≈ 1.0M L2 gas) and a zero DA fee; 1.5M L2 gas bounds that with margin.
 */
export const ESTIMATED_GAS_PER_TX: Gas = { daGas: 20_000, l2Gas: 1_500_000 }

/** Fee Juice bound for a batch of txs: estimated gas at the worst predicted fee of each dimension, times `headroom`. */
export function feeBudget(p: { txCount: number; gasPerTx: Gas; predicted: readonly FeesPerGas[]; headroom: bigint }): bigint {
	if (p.predicted.length === 0) throw new Error("no predicted fees: cannot bound the budget")
	let worstDa = 0n
	let worstL2 = 0n
	for (const f of p.predicted) {
		if (f.feePerDaGas > worstDa) worstDa = f.feePerDaGas
		if (f.feePerL2Gas > worstL2) worstL2 = f.feePerL2Gas
	}
	const perTx = BigInt(p.gasPerTx.daGas) * worstDa + BigInt(p.gasPerTx.l2Gas) * worstL2
	return perTx * BigInt(p.txCount) * p.headroom
}
