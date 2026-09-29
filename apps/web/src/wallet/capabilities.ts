import { AztecAddress } from "@aztec/aztec.js/addresses"
import { STANDARD_AUTH_REGISTRY_ADDRESS } from "@aztec/standard-contracts/auth-registry/constants"
import type { BridgeManifest } from "@inference-money/bridge-core/manifest"

interface ScopedFunction {
	readonly contract: AztecAddress
	readonly function: string
}

export interface AppManifest {
	readonly version: "1.0"
	readonly metadata: { name: string; version: string; description: string; url: string }
	readonly capabilities: readonly [
		{ type: "accounts"; canGet: true; canCreateAuthWit: true },
		{ type: "contracts"; contracts: readonly AztecAddress[]; canRegister: true },
		{
			type: "simulation"
			utilities: { scope: readonly ScopedFunction[] }
			transactions: { scope: readonly ScopedFunction[] }
		},
		{ type: "transaction"; scope: readonly ScopedFunction[] },
	]
}

const at = (contract: AztecAddress, functions: readonly string[]): ScopedFunction[] => functions.map((fn) => ({ contract, function: fn }))

const CLAIMS = ["claim_public", "claim_private"] as const
const EXITS = ["exit_to_l1_public", "exit_to_l1_private"] as const
const BURNS = ["burn_public", "burn_private"] as const

/**
 * The one grant the app requests, naming exact contracts and functions (never a wildcard): a wallet approval replaces
 * the stored grant wholesale, so every call the app makes must be in this single request.
 *
 * - `contracts`: what the app registers in the wallet (bridge, proxy, token, and the fee sponsor when the network has one).
 * - `simulation.utilities` holds `#[external("utility")]` reads; public `#[view]` reads and the claim dry-run are
 *   tx-shaped, so they belong in `simulation.transactions` (mis-scoping surfaces as "Function artifact not found").
 * - `transaction`: the sends, the burn the exit authorizes for the proxy, the public authwit's `set_authorized`, and
 *   the sponsor's fee call, since a wallet checks every call it executes against this scope.
 */
export function buildBridgeManifest(m: BridgeManifest, appUrl: string): AppManifest {
	const bridge = AztecAddress.fromStringUnsafe(m.l2.bridge.address)
	const token = AztecAddress.fromStringUnsafe(m.l2.token.address)
	const proxy = AztecAddress.fromStringUnsafe(m.l2.proxy.address)
	const sponsor = m.l2.sponsoredFpc ? AztecAddress.fromStringUnsafe(m.l2.sponsoredFpc) : undefined
	const sponsorCall = sponsor ? at(sponsor, ["sponsor_unconditionally"]) : []
	return {
		version: "1.0",
		metadata: { name: "usdc-bridge", version: "0.1.0", description: "Move USDC between Ethereum and Aztec", url: appUrl },
		capabilities: [
			{ type: "accounts", canGet: true, canCreateAuthWit: true },
			{
				type: "contracts",
				contracts: [bridge, proxy, token, ...(sponsor ? [sponsor] : [])],
				canRegister: true,
			},
			{
				type: "simulation",
				utilities: { scope: at(token, ["balance_of_private"]) },
				transactions: { scope: [...at(token, ["balance_of_public"]), ...at(bridge, CLAIMS), ...sponsorCall] },
			},
			{
				type: "transaction",
				scope: [
					...at(bridge, [...CLAIMS, ...EXITS]),
					...at(token, BURNS),
					{ contract: STANDARD_AUTH_REGISTRY_ADDRESS, function: "set_authorized" },
					...sponsorCall,
				],
			},
		],
	}
}
