import type { AztecAddress } from "@aztec-labs/aztec.js/addresses"
import { L1FeeJuicePortalManager, type L2AmountClaim } from "@aztec-labs/aztec.js/ethereum"
import { Fr } from "@aztec-labs/aztec.js/fields"
import { waitForL1ToL2MessageReady } from "@aztec-labs/aztec.js/messaging"
import type { AztecNode } from "@aztec-labs/aztec.js/node"
import { createEthereumChain } from "@aztec-labs/ethereum/chain"
import { createExtendedL1Client } from "@aztec-labs/ethereum/client"
import { createLogger } from "@aztec-labs/foundation/log"
import type { Hex } from "viem"

/**
 * Mints the testnet fee asset from its permissionless L1 handler and bridges it to `to` as Fee Juice.
 * Resolves once the L1→L2 message is consumable on L2, so the claim can be spent in the next tx.
 */
export async function bridgeFeeJuice(p: {
	node: AztecNode
	l1RpcUrl: string
	l1PrivateKey: Hex
	to: AztecAddress
	l1ChainId: number
	log: (msg: string) => void
}): Promise<L2AmountClaim> {
	// Aztec's L1 helpers are typed against its own viem fork, so the key crosses as a string, in process.
	const chain = createEthereumChain([p.l1RpcUrl], p.l1ChainId)
	const l1 = createExtendedL1Client(chain.rpcUrls, p.l1PrivateKey, chain.chainInfo)
	const portal = await L1FeeJuicePortalManager.new(p.node, l1, createLogger("deployer:fee-juice"))
	p.log(`minting + bridging Fee Juice to ${p.to}`)
	const claim = await portal.bridgeTokensPublic(p.to, undefined, true)
	p.log(`bridged ${claim.claimAmount} (message ${claim.messageHash}); waiting until it is consumable on L2`)
	await waitForL1ToL2MessageReady(p.node, Fr.fromHexString(claim.messageHash), { timeoutSeconds: 1800 })
	return claim
}
