import type { Address, Hex } from "viem"
import type { BridgeEvmArtifacts } from "./evm"
import { deployEvm, type L1Signer, writeEvm } from "./l1"

/** The portal's constructor records the deployer as its only initializer; `initializePortal` must come from the same account. */
export const deployPortal = (l1: L1Signer, evm: BridgeEvmArtifacts) => deployEvm(l1, "TokenPortal", evm.portal)

export async function initializePortal(
	l1: L1Signer,
	evm: BridgeEvmArtifacts,
	portal: Address,
	registry: Address,
	usdc: Address,
	l2Bridge: Hex,
): Promise<void> {
	await writeEvm(l1, "portal.initialize", portal, evm.portal.abi, "initialize", [registry, usdc, l2Bridge])
}

/** Reverts unless the portal is already initialized: the router binds the portal's token at construction. */
export const deployRouter = (l1: L1Signer, evm: BridgeEvmArtifacts, permit2: Address, portal: Address) =>
	deployEvm(l1, "Permit2DepositRouter", evm.router, [permit2, portal])

/** Local only: a 6-decimal, freely mintable stand-in for Circle's USDC. */
export const deployMockUsdc = (l1: L1Signer, evm: BridgeEvmArtifacts) => deployEvm(l1, "MockUsdc", evm.mockUsdc)
