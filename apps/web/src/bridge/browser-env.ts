import { AztecAddress } from "@aztec/aztec.js/addresses"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { MANIFEST } from "@/config/network"
import { l1Context } from "@/wallet/l1"
import { aztecSession } from "@/wallet/session"
import { type BridgeEnv, bridgeOps, webLocks } from "./env"
import { switchGate } from "./gate"
import { createInFlight } from "./pending"

/** The page's environment: the embedded manifest's node, the connected wallets, this tab's locks and unload guard. */
export function createBrowserEnv(): BridgeEnv {
	return {
		manifest: MANIFEST,
		node: createAztecNodeClient(MANIFEST.l2.nodeUrl),
		ops: bridgeOps,
		l1: l1Context,
		l2: () => {
			const s = aztecSession.getSnapshot()
			if (s.status !== "connected" || !s.wallet || !s.selectedAccount || !s.contractsReady) {
				throw new Error("Connect your Aztec wallet first.")
			}
			return { wallet: s.wallet, account: AztecAddress.fromStringUnsafe(s.selectedAccount) }
		},
		session: aztecSession,
		locks: webLocks(),
		inFlight: createInFlight(window),
		gate: switchGate,
	}
}
