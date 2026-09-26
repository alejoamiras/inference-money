import type { ChainInfo } from "@aztec/aztec.js/account"
import { Fr } from "@aztec/aztec.js/fields"
import { type BridgeManifest, parseManifest } from "@inference-money/bridge-core/manifest"
import { type Chain, defineChain } from "viem"

/** Re-validated at startup: a bundle whose embedded manifest does not parse must not render a bridge. */
export const MANIFEST: BridgeManifest = parseManifest(__BRIDGE_MANIFEST__)

export const WEB_WALLET_URLS: readonly string[] = __WEB_WALLET_URLS__

/** The L1 chain, with no RPC URL on purpose: every L1 read goes through the connected wallet, never a page fetch. */
export const L1_CHAIN: Chain = defineChain({
	id: MANIFEST.l1.chainId,
	name: MANIFEST.l1.chainId === 11155111 ? "Sepolia" : `Chain ${MANIFEST.l1.chainId}`,
	nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
	rpcUrls: { default: { http: [] } },
})

/** The Aztec network identity the wallet handshake names; `assertSigningContext` checks the same pair. */
export const AZTEC_CHAIN_INFO: ChainInfo = {
	chainId: new Fr(MANIFEST.l1.chainId),
	version: new Fr(MANIFEST.l2.rollupVersion),
}
