import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract } from "@aztec/aztec.js/contracts"
import { type BridgeManifest, tokenArtifact } from "@inference-money/bridge-core"
import { type Address, erc20Abi, type PublicClient } from "viem"
import type { L2Ctx } from "./env"

export type L2BalanceKind = "public" | "private"

/** The account's bridged USDC on Aztec, read through its wallet (the grant covers both reads). */
export async function l2Balance(l2: L2Ctx, m: BridgeManifest, kind: L2BalanceKind): Promise<bigint> {
	const token = Contract.at(AztecAddress.fromStringUnsafe(m.l2.token.address), tokenArtifact, l2.wallet)
	const read = kind === "public" ? token.methods.balance_of_public : token.methods.balance_of_private
	if (!read) throw new Error(`The token artifact has no balance_of_${kind}.`)
	const { result } = await read(l2.account).simulate({ from: l2.account })
	return BigInt(result)
}

type Reader = Pick<PublicClient, "readContract">

export const l1UsdcBalance = (client: Reader, m: BridgeManifest, who: Address): Promise<bigint> =>
	client.readContract({ address: m.l1.usdc, abi: erc20Abi, functionName: "balanceOf", args: [who] })

export const permit2Allowance = (client: Reader, m: BridgeManifest, who: Address): Promise<bigint> =>
	client.readContract({ address: m.l1.usdc, abi: erc20Abi, functionName: "allowance", args: [who, m.l1.permit2] })
