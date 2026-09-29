import { createHash } from "node:crypto"
import { NO_FROM } from "@aztec/aztec.js/account"
import { AztecAddress, EthAddress } from "@aztec/aztec.js/addresses"
import { BatchCall, Contract } from "@aztec/aztec.js/contracts"
import type { FeePaymentMethod } from "@aztec/aztec.js/fee"
import { Fq, Fr } from "@aztec/aztec.js/fields"
import type { AztecNode } from "@aztec/aztec.js/node"
import type { ContractArtifact } from "@aztec/stdlib/abi"
import type { EmbeddedWallet } from "@aztec/wallets/embedded"
import {
	instanceRecord,
	type L2InstanceRecord,
	tokenArtifact,
	tokenBridgeArtifact,
	tokenMinterProxyArtifact,
} from "@inference-money/bridge-core"
import type { Address } from "viem"

/** How a network pays: the account deploy (the account has no balance yet), then every later tx (undefined: its own Fee Juice). */
export interface L2Fees {
	accountDeploy(account: AztecAddress): Promise<FeePaymentMethod>
	tx: FeePaymentMethod | undefined
}

/** Bound to the secret, so whoever holds it can always rebuild the owner account. */
export function signingKeyFor(secret: Fr): Fq {
	return Fq.fromBufferReduce(createHash("sha256").update("inference-money/schnorr-signing-key").update(secret.toBuffer()).digest())
}

/** Registers the deployer's Schnorr account in `wallet`, deploying it first if the node has never seen it. */
export async function ensureDeployerAccount(
	wallet: EmbeddedWallet,
	node: Pick<AztecNode, "getContract">,
	secret: Fr,
	fees: L2Fees,
	log: (m: string) => void,
): Promise<AztecAddress> {
	const manager = await wallet.createSchnorrAccount(secret, Fr.ZERO, signingKeyFor(secret))
	if (await node.getContract(manager.address)) {
		log(`deployer ${manager.address}: already deployed`)
		return manager.address
	}
	log(`deployer ${manager.address}: deploying`)
	const deploy = await manager.getDeployMethod()
	await deploy.send({ from: NO_FROM, fee: { paymentMethod: await fees.accountDeploy(manager.address) } })
	return manager.address
}

export interface L2Deployment {
	proxy: L2InstanceRecord
	token: L2InstanceRecord
	bridge: L2InstanceRecord
}

/**
 * Proxy, Token (minter = proxy), bridge(proxy, portal), then the proxy's one-shot `set_token` + `set_bridge` in one
 * batch. Every instance is bound to `deployer`: aztec-nr refuses any other initializer, so nobody can front-run an
 * initialization and capture ownership.
 */
export async function deployBridgeL2(
	wallet: EmbeddedWallet,
	deployer: AztecAddress,
	fees: L2Fees,
	portal: Address,
	log: (m: string) => void,
): Promise<L2Deployment> {
	const send = { from: deployer, fee: fees.tx ? { paymentMethod: fees.tx } : undefined }
	const deployOne = async (label: string, artifact: ContractArtifact, initializer: string, args: unknown[]) => {
		const method = Contract.deploy(wallet, artifact, args, initializer, { deployer, salt: Fr.random() })
		const instance = await method.getInstance()
		log(`${label} ${instance.address}: deploying`)
		await method.send(send)
		return instanceRecord(instance, initializer, args as never)
	}
	const proxy = await deployOne("proxy", tokenMinterProxyArtifact, "constructor", [])
	const proxyAddress = AztecAddress.fromStringUnsafe(proxy.address)
	const token = await deployOne("token", tokenArtifact, "constructor_with_minter", [
		"USD Coin",
		"USDC",
		6,
		proxyAddress,
		AztecAddress.ZERO,
	])
	const bridge = await deployOne("bridge", tokenBridgeArtifact, "constructor", [proxyAddress, EthAddress.fromString(portal)])
	log("proxy: set_token + set_bridge")
	const p = Contract.at(proxyAddress, tokenMinterProxyArtifact, wallet)
	const wiring = [
		p.methods.set_token!(AztecAddress.fromStringUnsafe(token.address)),
		p.methods.set_bridge!(AztecAddress.fromStringUnsafe(bridge.address)),
	]
	await new BatchCall(wallet, wiring).send(send)
	return { proxy, token, bridge }
}
