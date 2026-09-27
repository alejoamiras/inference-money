import { type BridgeManifest, l2UsdcBalance } from "@inference-money/bridge-core"
import { type Address, erc20Abi, type PublicClient } from "viem"
import type { L2Ctx } from "./env"

export type L2BalanceKind = "public" | "private"

/** The account's bridged USDC on Aztec, read through its wallet (the grant covers both reads). */
export const l2Balance = (l2: L2Ctx, m: BridgeManifest, kind: L2BalanceKind): Promise<bigint> =>
	l2UsdcBalance(l2.wallet, m, l2.account, kind)

type Reader = Pick<PublicClient, "readContract">

export const l1UsdcBalance = (client: Reader, m: BridgeManifest, who: Address): Promise<bigint> =>
	client.readContract({ address: m.l1.usdc, abi: erc20Abi, functionName: "balanceOf", args: [who] })

export const permit2Allowance = (client: Reader, m: BridgeManifest, who: Address): Promise<bigint> =>
	client.readContract({ address: m.l1.usdc, abi: erc20Abi, functionName: "allowance", args: [who, m.l1.permit2] })
