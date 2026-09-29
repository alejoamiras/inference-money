import { Fr } from "@aztec-labs/aztec.js/fields"
import type { EpochNumber } from "@aztec-labs/foundation/branded-types"
import type { OutboxRootsReader } from "@aztec-labs/stdlib/messaging"
import type { Address, PublicClient } from "viem"
import { OUTBOX_ABI } from "./abi"

export interface OutboxReader extends OutboxRootsReader {
	isConsumed(epoch: bigint, leafId: bigint): Promise<boolean>
}

/** The L1 Outbox over canonical viem: `@aztec-labs/ethereum`'s OutboxContract would pull a second viem into bridge-core. */
export function outboxReader(l1: PublicClient, outbox: Address): OutboxReader {
	return {
		async getRoots(epoch: EpochNumber) {
			const roots = await l1.readContract({ address: outbox, abi: OUTBOX_ABI, functionName: "getRoots", args: [BigInt(epoch)] })
			return roots.map((r) => Fr.fromHexString(r))
		},
		isConsumed: (epoch, leafId) =>
			l1.readContract({ address: outbox, abi: OUTBOX_ABI, functionName: "hasMessageBeenConsumedAtEpoch", args: [epoch, leafId] }),
	}
}
