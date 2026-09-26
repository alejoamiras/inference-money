import type { Address, PublicClient, WalletClient } from "viem"

/** The connected L1 side: reads through `publicClient`, signs and sends through `walletClient` as `account`. */
export interface L1Ctx {
	publicClient: PublicClient
	walletClient: WalletClient
	account: Address
}

export type StageSink<S extends string> = (stage: S) => void

/** The largest amount the L2 token holds (u128); the router and portal reject anything above it. */
export const MAX_L2_AMOUNT = 2n ** 128n - 1n
