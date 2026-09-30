import { AztecAddress } from "@aztec-labs/aztec.js/addresses"
import { Fr } from "@aztec-labs/aztec.js/fields"
import type { Wallet } from "@aztec-labs/aztec.js/wallet"
import type { ContractArtifact } from "@aztec-labs/stdlib/abi"
import { type ContractInstanceWithAddress, getContractInstanceFromInstantiationParams } from "@aztec-labs/stdlib/contract"
import { PublicKeys } from "@aztec-labs/stdlib/keys"
import type { Hex } from "viem"
import { tokenArtifact, tokenBridgeArtifact, tokenMinterProxyArtifact } from "./artifacts"
import type { BridgeManifest, L2InstanceRecord } from "./manifest"

type Arg = string | number | bigint | { toString(): string }

/** The manifest form of a deployed instance: every constructor arg as the string the ABI encoder reads back. */
export function instanceRecord(instance: ContractInstanceWithAddress, initializer: string, args: readonly Arg[]): L2InstanceRecord {
	return {
		address: instance.address.toString() as Hex,
		salt: instance.salt.toString() as Hex,
		deployer: instance.deployer.toString() as Hex,
		initializer,
		constructorArgs: args.map((a) => a.toString()),
		publicKeys: instance.publicKeys.toString() as Hex,
		classId: instance.currentContractClassId.toString() as Hex,
	}
}

/** Re-derives the instance a record describes; throws unless it lands on the recorded address and class. */
export async function instanceFromRecord(artifact: ContractArtifact, r: L2InstanceRecord): Promise<ContractInstanceWithAddress> {
	const instance = await getContractInstanceFromInstantiationParams(artifact, {
		constructorArtifact: r.initializer,
		constructorArgs: r.constructorArgs,
		salt: Fr.fromHexString(r.salt),
		deployer: AztecAddress.fromStringUnsafe(r.deployer),
		publicKeys: PublicKeys.fromString(r.publicKeys),
	})
	if (instance.address.toString() !== r.address || instance.currentContractClassId.toString() !== r.classId) {
		throw new Error(
			`manifest record for ${artifact.name} derives ${instance.address} (class ${instance.currentContractClassId}), not ${r.address}`,
		)
	}
	return instance
}

export const BRIDGE_CONTRACTS = [
	["proxy", tokenMinterProxyArtifact],
	["token", tokenArtifact],
	["bridge", tokenBridgeArtifact],
] as const

/** Registers proxy, token and bridge in `wallet` from the manifest, each verified against its recorded address first. */
export async function registerBridgeContracts(wallet: Pick<Wallet, "registerContract">, m: BridgeManifest): Promise<void> {
	for (const [key, artifact] of BRIDGE_CONTRACTS) {
		await wallet.registerContract(await instanceFromRecord(artifact, m.l2[key]), artifact)
	}
}
