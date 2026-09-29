import { registerBridgeContracts, registerSponsor } from "@inference-money/bridge-core"
import { switchGate } from "@/bridge/gate"
import { AZTEC_CHAIN_INFO, MANIFEST, WEB_WALLET_URLS } from "@/config/network"
import { createAztecWalletSession } from "./aztec-session"
import { buildBridgeManifest } from "./capabilities"

/** The app's one Aztec connection: one grant, one active account, shared by every screen. */
export const aztecSession = createAztecWalletSession({
	appId: "usdc-bridge",
	chainInfo: AZTEC_CHAIN_INFO,
	webWalletUrls: WEB_WALLET_URLS,
	buildManifest: async () => buildBridgeManifest(MANIFEST, window.location.origin),
	registerContracts: async (wallet) => {
		await registerBridgeContracts(wallet, MANIFEST)
		// The wallet must know the sponsor's class to pay a private claim or exit through it.
		if (MANIFEST.l2.sponsoredFpc) await registerSponsor(wallet, MANIFEST)
	},
	isSwitchBlocked: switchGate.blocked,
})
