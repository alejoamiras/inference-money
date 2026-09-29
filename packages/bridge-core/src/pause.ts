import { AztecAddress } from "@aztec/aztec.js/addresses"
import type { Fr } from "@aztec/aztec.js/fields"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import { tokenBridgeArtifact } from "./artifacts"
import type { BridgeManifest } from "./manifest"

export type PauseSource = Pick<AztecNode, "getPublicStorageAt">

/**
 * The bridge has no pause getter, so the flag is read from public storage at the slot its artifact's layout assigns;
 * a layout change moves the slot with the artifact.
 */
const pausedSlot = (): Fr => {
	const slot = tokenBridgeArtifact.storageLayout.is_paused?.slot
	if (!slot) throw new Error("The bridge artifact has no is_paused storage slot.")
	return slot
}

/** The bridge refuses claims and exits while paused; a deposit sent now could only be claimed after an unpause. */
export class BridgePausedError extends Error {
	constructor() {
		super("The bridge is paused. Deposits are refused until it resumes.")
		this.name = "BridgePausedError"
	}
}

export async function isBridgePaused(node: PauseSource, m: BridgeManifest): Promise<boolean> {
	return !(await node.getPublicStorageAt("latest", AztecAddress.fromStringUnsafe(m.l2.bridge.address), pausedSlot())).isZero()
}

export async function assertBridgeLive(node: PauseSource, m: BridgeManifest): Promise<void> {
	if (await isBridgePaused(node, m)) throw new BridgePausedError()
}
