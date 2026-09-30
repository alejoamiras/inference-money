import { STANDARD_AUTH_REGISTRY_ADDRESS } from "@aztec-labs/standard-contracts/auth-registry/constants"
import { describe, expect, it } from "vitest"
import { MANIFEST } from "@/config/network"
import { buildBridgeManifest } from "./capabilities"

const flat = (scope: readonly { contract: { toString(): string }; function: string }[]) =>
	scope.map((s) => `${s.contract.toString()}:${s.function}`)

describe("buildBridgeManifest", () => {
	const [accounts, contracts, simulation, transaction] = buildBridgeManifest(MANIFEST, "https://app.example").capabilities
	const { bridge, token, proxy } = MANIFEST.l2
	const sponsor = MANIFEST.l2.sponsoredFpc as string

	it("grants exactly the bridge's sends, the proxy's burns, the public authwit and the sponsor fee call", () => {
		expect(flat(transaction.scope).sort()).toEqual(
			[
				`${bridge.address}:claim_public`,
				`${bridge.address}:claim_private`,
				`${bridge.address}:exit_to_l1_public`,
				`${bridge.address}:exit_to_l1_private`,
				`${token.address}:burn_public`,
				`${token.address}:burn_private`,
				`${STANDARD_AUTH_REGISTRY_ADDRESS.toString()}:set_authorized`,
				`${sponsor}:sponsor_unconditionally`,
			].sort(),
		)
		expect(accounts.canCreateAuthWit).toBe(true)
	})

	it("scopes utility reads apart from tx-shaped simulations and registers every contract it calls", () => {
		expect(flat(simulation.utilities.scope)).toEqual([`${token.address}:balance_of_private`])
		expect(flat(simulation.transactions.scope)).toContain(`${bridge.address}:claim_private`)
		expect(flat(simulation.transactions.scope)).toContain(`${token.address}:balance_of_public`)
		expect(contracts.contracts.map(String)).toEqual([bridge.address, proxy.address, token.address, sponsor])
	})

	it("drops the sponsor entirely on a network without one", () => {
		const { sponsoredFpc: _, ...l2 } = MANIFEST.l2
		const caps = buildBridgeManifest({ ...MANIFEST, l2 }, "https://app.example").capabilities
		expect(JSON.stringify(caps)).not.toContain(sponsor.slice(2))
	})
})
