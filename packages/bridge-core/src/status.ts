import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import { type BridgeProgress, computeProgress } from "./progress"

/** The node's proven tip; aztec.js 5.x names it by tag, not by a dedicated getter. */
export type ProvenBlockSource = Pick<AztecNode, "getBlockNumber">

/** Deposit (L1->L2) progress: time-based, ~4 min inclusion by default. */
export function depositStatus(createdAtMs: number, maxWaitMs = 240_000, nowMs: number = Date.now()): BridgeProgress {
	return computeProgress({ elapsedMs: Math.max(0, nowMs - createdAtMs), maxWaitMs })
}

/** Withdraw (L2->L1) progress: withdrawable on L1 once the proven block reaches the exit's block. */
export async function withdrawStatus(
	node: ProvenBlockSource,
	neededBlock: number,
	startBlock: number,
	secondsPerBlock = 36,
): Promise<BridgeProgress> {
	const provenBlock = Number(await node.getBlockNumber("proven"))
	return computeProgress({ provenBlock, neededBlock, startBlock, elapsedMs: 0, maxWaitMs: 0, secondsPerBlock })
}
