import type { AztecAddress } from "@aztec/aztec.js/addresses"
import { Fr } from "@aztec/aztec.js/fields"
import type { Wallet } from "@aztec/aztec.js/wallet"
import { type ContractArtifact, FunctionSelector, loadContractArtifact } from "@aztec/stdlib/abi"
import { getContractInstanceFromInstantiationParams } from "@aztec/stdlib/contract"
import handshakeJson from "../vendor/HandshakeRegistry-5.0.0.json"

/**
 * A 5.2.0 PXE against a 5.0.0 network. The canonical SponsoredFPC was compiled against aztec-nr 5.0.0 and reads that
 * release's HandshakeRegistry while it executes; aztec.js 5.2.0 preloads and auto-authorizes only its own registry
 * and the archived 5.0.1 one. Registering the 5.0.0 deployment and authorizing the same two reads PXE grants those
 * restores the sponsor, without widening anything else.
 */
export const legacyHandshakeRegistryArtifact: ContractArtifact = loadContractArtifact(handshakeJson as never)
export const legacyHandshakeRegistry = () =>
	getContractInstanceFromInstantiationParams(legacyHandshakeRegistryArtifact, { salt: new Fr(1) })

// PXE's default-authorized read signatures for standard handshake registries.
const READS = ["get_non_interactive_handshakes((Field),u32)", "get_app_siloed_secrets((Field),(Field))"]

export interface UtilityCallRequest {
	target: AztecAddress
	functionSelector: FunctionSelector
}

/** A PXE `authorizeUtilityCall` hook: only those two reads on the 5.0.0 registry; every other cross-contract utility call stays denied. */
export async function authorizeLegacyHandshakeReads(req: UtilityCallRequest): Promise<{ authorized: boolean; reason?: string }> {
	if (!req.target.equals((await legacyHandshakeRegistry()).address))
		return { authorized: false, reason: "not the 5.0.0 HandshakeRegistry" }
	for (const signature of READS) {
		if (req.functionSelector.equals(await FunctionSelector.fromSignature(signature))) return { authorized: true }
	}
	return { authorized: false, reason: "not a HandshakeRegistry read" }
}

export async function registerLegacyHandshakeRegistry(wallet: Pick<Wallet, "registerContract">): Promise<void> {
	await wallet.registerContract(await legacyHandshakeRegistry(), legacyHandshakeRegistryArtifact)
}
