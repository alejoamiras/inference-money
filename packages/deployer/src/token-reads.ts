import type { AztecAddress } from "@aztec-labs/aztec.js/addresses"
import type { Fr } from "@aztec-labs/aztec.js/fields"
import type { AztecNode } from "@aztec-labs/aztec.js/node"
import { BlockNumber } from "@aztec-labs/foundation/branded-types"
import { DelayedPublicMutableValues } from "@aztec-labs/stdlib/delayed-public-mutable"
import { deriveStorageSlotInMap } from "@aztec-labs/stdlib/hash"
import { delayAt, MERCHANT_MIN_DELAY, tokenArtifact } from "@inference-money/bridge-core"

/** A delayed slot's delay in force at `at`, the one scheduled to follow, and when that takes over. */
export interface DelayState {
	current: bigint
	scheduled: bigint
	changeAt: bigint
}

export function tokenSlot(field: string): Fr {
	const layout = tokenArtifact.storageLayout[field]
	if (!layout) throw new Error(`the token artifact has no ${field} storage`)
	return layout.slot
}

async function delayOf(node: Pick<AztecNode, "getPublicStorageAt">, token: AztecAddress, slot: Fr, block: number, at: bigint) {
	const read = (s: Fr) => node.getPublicStorageAt(BlockNumber(block), token, s)
	const { sdc } = await DelayedPublicMutableValues.readFromTree(slot, read)
	return { current: delayAt(sdc, at), scheduled: sdc.post ?? MERCHANT_MIN_DELAY, changeAt: sdc.timestampOfChange }
}

/** A merchant's switch-off entry delay, read at `block` (timestamp `at`). */
export async function entryDelay(
	node: Pick<AztecNode, "getPublicStorageAt">,
	token: AztecAddress,
	account: AztecAddress,
	block: number,
	at: bigint,
): Promise<DelayState> {
	return delayOf(node, token, await deriveStorageSlotInMap(tokenSlot("merchant_off"), account), block, at)
}

/** The guardian slot's delay, read at `block` (timestamp `at`). */
export const guardianDelay = (node: Pick<AztecNode, "getPublicStorageAt">, token: AztecAddress, block: number, at: bigint) =>
	delayOf(node, token, tokenSlot("merchant_guardian"), block, at)
