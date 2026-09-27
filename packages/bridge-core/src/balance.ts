import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract } from "@aztec/aztec.js/contracts"
import type { Wallet } from "@aztec/aztec.js/wallet"
import { tokenArtifact } from "./artifacts"
import type { DepositKind } from "./deposit"
import type { BridgeManifest } from "./manifest"

/** `who`'s bridged USDC on Aztec, simulated as `who`; a private balance counts only the notes `wallet` can decrypt. */
export async function l2UsdcBalance(wallet: Wallet, m: BridgeManifest, who: AztecAddress, kind: DepositKind): Promise<bigint> {
	const token = Contract.at(AztecAddress.fromStringUnsafe(m.l2.token.address), tokenArtifact, wallet)
	const read = kind === "public" ? token.methods.balance_of_public : token.methods.balance_of_private
	if (!read) throw new Error(`The token artifact has no balance_of_${kind}.`)
	const { result } = await read(who).simulate({ from: who })
	return BigInt(result)
}
