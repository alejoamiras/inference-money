import { Fr } from "@aztec-labs/aztec.js/fields"
import { TxHash } from "@aztec-labs/aztec.js/tx"
import { MAX_CHECKPOINTS_PER_EPOCH } from "@aztec-labs/constants"
import { computeL2ToL1MembershipWitnessFromMessagesInEpoch, getL2ToL1MessageLeafId } from "@aztec-labs/stdlib/messaging"
import type { ExitNode } from "../exit"
import type { OutboxReader } from "../outbox"

/**
 * One proven epoch holding a single checkpoint and block, whose second tx emits `txMessages`, served through the node
 * and Outbox calls the real stdlib witness helper makes. `outboxRoot` scripts what L1 holds per `getRoots` read:
 * "proven" (the true root), "unproven" (none yet) or "mismatch" (a root the node's view does not produce).
 */
export function fakeEpoch(txMessages: Fr[]) {
	const EPOCH = 5
	const messagesInEpoch = [[[[new Fr(0xdead)], txMessages]]]
	const truth = (index: number) => computeL2ToL1MembershipWitnessFromMessagesInEpoch(messagesInEpoch, txMessages[index]!, 0, 0, 1, index)
	const state = {
		outboxRoot: [] as ("proven" | "unproven" | "mismatch")[],
		consumed: new Set<number>(),
		rootReads: 0,
	}
	const txHash = TxHash.random()
	const node = {
		getTxReceipt: async () => ({ epochNumber: EPOCH, blockNumber: 42, txIndexInBlock: 1 }),
		getL2ToL1Messages: async () => messagesInEpoch,
		getBlock: async () => ({ checkpointNumber: 9, indexWithinCheckpoint: 0 }),
		getCheckpointsData: async () => [{ checkpointNumber: 9 }],
		getTxEffect: async () => ({ data: { l2ToL1Msgs: txMessages } }),
	} as unknown as ExitNode
	const leafIdOf = (index: number) => getL2ToL1MessageLeafId(truth(index))
	const outbox: OutboxReader = {
		async getRoots() {
			const scripted = state.outboxRoot[Math.min(state.rootReads++, state.outboxRoot.length - 1)] ?? "proven"
			const roots = Array.from({ length: MAX_CHECKPOINTS_PER_EPOCH }, () => Fr.ZERO)
			if (scripted === "proven") roots[0] = truth(0).root
			if (scripted === "mismatch") roots[0] = new Fr(0xbad)
			return roots
		},
		isConsumed: async (epoch, leafId) => epoch === BigInt(EPOCH) && [...state.consumed].some((i) => leafIdOf(i) === leafId),
	}
	return { EPOCH, node, outbox, state, txHash, truth }
}
