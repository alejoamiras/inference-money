import { type Account, type Address, isAddressEqual, type PublicClient, type WalletClient } from "viem"

/** The connected L1 side: reads through `publicClient`, signs and sends through `walletClient` as `account`. */
export interface L1Ctx {
	publicClient: PublicClient
	walletClient: WalletClient
	account: Address
}

export type StageSink<S extends string> = (stage: S) => void

/**
 * Who signs for `l1.account`: the wallet client's own account when it is that address (a local key signs in process),
 * otherwise the bare address, which a JSON-RPC wallet signs for. Either way it is pinned to the reviewed account.
 */
export function signerOf(l1: L1Ctx): Account | Address {
	const own = l1.walletClient.account
	return own && isAddressEqual(own.address, l1.account) ? own : l1.account
}

/** The largest amount the L2 token holds (u128); the router and portal reject anything above it. */
export const MAX_L2_AMOUNT = 2n ** 128n - 1n
