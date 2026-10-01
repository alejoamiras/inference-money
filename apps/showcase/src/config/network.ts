import { type BridgeManifest, parseManifest } from "@inference-money/bridge-core/manifest"
import { type Chain, defineChain } from "viem"

/** Re-validated at startup: a bundle whose embedded manifest does not parse must not render a bridge. */
export const MANIFEST: BridgeManifest = parseManifest(__BRIDGE_MANIFEST__)

export const USERS_TAG: string = __SHOWCASE_USERS_TAG__
export const L1_RPC_URL: string = __SHOWCASE_L1_RPC__
/** Whether the embedded wallet proves for real: always on testnet, on local only in the proving harness. */
export const PROVES: boolean = __SHOWCASE_PROOFS__ === "real"

export const L1_CHAIN: Chain = defineChain({
	id: MANIFEST.l1.chainId,
	name: MANIFEST.l1.chainId === 11155111 ? "Sepolia" : `Chain ${MANIFEST.l1.chainId}`,
	nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
	rpcUrls: { default: { http: [L1_RPC_URL] } },
})
