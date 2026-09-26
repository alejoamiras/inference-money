import type { AztecAddress } from "@aztec/aztec.js/addresses"
import type { Address, PublicClient } from "viem"
import { REGISTRY_ABI, ROLLUP_ABI } from "./abi"
import type { BridgeManifest } from "./manifest"
import type { L1Ctx } from "./types"

/**
 * The chain id Aztec wallets present to dapps: `(l1ChainId XOR rollupVersion)` as an unsigned 32-bit integer. Never the
 * bare rollup version, which no wallet recognizes.
 */
export const walletChainIdOf = (l1ChainId: number, rollupVersion: number): number => (l1ChainId ^ rollupVersion) >>> 0

export interface NodeIdentitySource {
	getNodeInfo(): Promise<{
		nodeVersion: string
		l1ChainId: number
		rollupVersion: number
		l1ContractAddresses: {
			registryAddress: { toString(): string }
			inboxAddress: { toString(): string }
			outboxAddress: { toString(): string }
		}
	}>
}

export interface L2ChainSource {
	getChainInfo(): Promise<{ chainId: { toBigInt(): bigint }; version: { toBigInt(): bigint } }>
	getAccounts(): Promise<{ item: AztecAddress }[]>
}

/** Thrown before anything is signed: the connected network or signer is not the one the manifest names. */
export class NetworkMismatchError extends Error {
	constructor(readonly mismatches: string[]) {
		super(`Refusing to continue: ${mismatches.join("; ")}.`)
		this.name = "NetworkMismatchError"
	}
}

type Pin = [label: string, actual: unknown, expected: unknown]

const addr = (a: { toString(): string }) => a.toString().toLowerCase()

function mismatches(pins: Pin[]): string[] {
	return pins
		.filter(([, actual, expected]) => actual !== expected)
		.map(([label, actual, expected]) => `${label} is ${String(actual)}, expected ${String(expected)}`)
}

/** A verdict read from any chain but the manifest's says nothing about its contracts. */
export async function assertReaderChain(l1: Pick<PublicClient, "getChainId">, chainId: number): Promise<void> {
	const actual = await l1.getChainId()
	if (actual !== chainId) throw new NetworkMismatchError([`the L1 reader's chain is ${actual}, expected ${chainId}`])
}

/** The node and the L1 chain (read through the registry's canonical rollup) must both be the manifest's network. */
export async function assertNetworkIdentity(node: NodeIdentitySource, l1: PublicClient, m: BridgeManifest): Promise<void> {
	const [info, chainId, rollup] = await Promise.all([
		node.getNodeInfo(),
		l1.getChainId(),
		l1.readContract({ address: m.l1.registry, abi: REGISTRY_ABI, functionName: "getCanonicalRollup" }),
	])
	const [inbox, outbox, version] = await Promise.all([
		l1.readContract({ address: rollup, abi: ROLLUP_ABI, functionName: "getInbox" }),
		l1.readContract({ address: rollup, abi: ROLLUP_ABI, functionName: "getOutbox" }),
		l1.readContract({ address: rollup, abi: ROLLUP_ABI, functionName: "getVersion" }),
	])
	const l1c = info.l1ContractAddresses
	const bad = mismatches([
		["the node version", info.nodeVersion, m.l2.nodeVersion],
		["the node's L1 chain", info.l1ChainId, m.l1.chainId],
		["the node's rollup version", info.rollupVersion, m.l2.rollupVersion],
		["the node's registry", addr(l1c.registryAddress), addr(m.l1.registry)],
		["the node's inbox", addr(l1c.inboxAddress), addr(m.l1.inbox)],
		["the node's outbox", addr(l1c.outboxAddress), addr(m.l1.outbox)],
		["the L1 chain", chainId, m.l1.chainId],
		["the canonical rollup's inbox", addr(inbox), addr(m.l1.inbox)],
		["the canonical rollup's outbox", addr(outbox), addr(m.l1.outbox)],
		["the canonical rollup's version", version, BigInt(m.l2.rollupVersion)],
	])
	if (bad.length > 0) throw new NetworkMismatchError(bad)
}

/**
 * The wallets that will sign are on the manifest's chains and still on the accounts the user reviewed. Call it
 * immediately before and after every signature: a wallet can switch chain or account while its prompt is open.
 */
export async function assertSigningContext(
	l1: L1Ctx,
	wallet: L2ChainSource | null,
	m: BridgeManifest,
	expected: { l1Account: Address; l2Account?: AztecAddress },
): Promise<void> {
	const [chainId, [selected]] = await Promise.all([l1.walletClient.getChainId(), l1.walletClient.getAddresses()])
	const pins: Pin[] = [
		["the L1 wallet's chain", chainId, m.l1.chainId],
		["the L1 wallet's account", addr(selected ?? "none"), addr(expected.l1Account)],
		["the signing account", addr(l1.account), addr(expected.l1Account)],
	]
	if (wallet) {
		const [info, accounts] = await Promise.all([wallet.getChainInfo(), expected.l2Account ? wallet.getAccounts() : []])
		pins.push(["the Aztec wallet's L1 chain", info.chainId.toBigInt(), BigInt(m.l1.chainId)])
		pins.push(["the Aztec wallet's rollup version", info.version.toBigInt(), BigInt(m.l2.rollupVersion)])
		const l2 = expected.l2Account
		if (l2 && !accounts.some((a) => a.item.equals(l2))) pins.push(["the Aztec account", "not in the wallet", l2.toString()])
	}
	const bad = mismatches(pins)
	if (bad.length > 0) throw new NetworkMismatchError(bad)
}
