import { type Account, type Address, type Chain, defineChain, isAddressEqual, type PublicClient, type WalletClient } from "viem"

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

/**
 * The chain every send names: viem then refuses a wallet on another chain at send time, which `chain: null` skips. The
 * wallet client's own chain when it is that one (it may carry fee formatters), else a bare definition of the id.
 */
export function sendChain(l1: L1Ctx, chainId: number): Chain {
	const own = l1.walletClient.chain
	if (own?.id === chainId) return own
	return defineChain({
		id: chainId,
		name: `chain ${chainId}`,
		nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
		rpcUrls: { default: { http: [] } },
	})
}

/** The largest amount the L2 token holds (u128); the router and portal reject anything above it. */
export const MAX_L2_AMOUNT = 2n ** 128n - 1n
