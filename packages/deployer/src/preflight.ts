import { AztecAddress } from "@aztec/aztec.js/addresses"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { getFeeJuiceBalance } from "@aztec/aztec.js/utils"
import { ManaUsageEstimate } from "@aztec/stdlib/gas"
import { type Address, createPublicClient, getAddress, http, isAddressEqual, type PublicClient, parseAbi } from "viem"
import { ESTIMATED_GAS_PER_TX, feeBudget, TESTNET_DEPLOY_AND_SMOKE_TXS } from "./budget"
import type { NetworkPins } from "./networks"

export interface Check {
	name: string
	ok: boolean
	detail: string
}

/** The node-info subset a network's identity is pinned by. */
export interface NodeIdentity {
	nodeVersion: string
	l1ChainId: number
	rollupVersion: number
	l1ContractAddresses: {
		registryAddress: { toString(): string }
		inboxAddress: { toString(): string }
		outboxAddress: { toString(): string }
	}
}

const eq = (a: string, b: string) => isAddressEqual(getAddress(a), getAddress(b))
const check = (name: string, ok: boolean, detail: string): Check => ({ name, ok, detail })

export function checkNodeIdentity(info: NodeIdentity, pins: NetworkPins): Check[] {
	const l1 = info.l1ContractAddresses
	return [
		check("node version", info.nodeVersion === pins.nodeVersion, `${info.nodeVersion} (want ${pins.nodeVersion})`),
		check("L1 chain id", info.l1ChainId === pins.l1ChainId, `${info.l1ChainId} (want ${pins.l1ChainId})`),
		check("rollup version", info.rollupVersion === pins.rollupVersion, `${info.rollupVersion} (want ${pins.rollupVersion})`),
		check("registry", eq(l1.registryAddress.toString(), pins.registry), l1.registryAddress.toString()),
		check("inbox", eq(l1.inboxAddress.toString(), pins.inbox), l1.inboxAddress.toString()),
		check("outbox", eq(l1.outboxAddress.toString(), pins.outbox), l1.outboxAddress.toString()),
	]
}

/** What Ethereum itself says the registry's canonical rollup is wired to. */
export interface L1Wiring {
	chainId: number
	inbox: Address
	outbox: Address
	version: bigint
}

export function checkL1Wiring(w: L1Wiring, pins: NetworkPins): Check[] {
	return [
		check("L1 RPC chain id", w.chainId === pins.l1ChainId, `${w.chainId}`),
		check("registry → rollup → inbox", eq(w.inbox, pins.inbox), w.inbox),
		check("registry → rollup → outbox", eq(w.outbox, pins.outbox), w.outbox),
		check("registry → rollup → version", w.version === BigInt(pins.rollupVersion), `${w.version}`),
	]
}

export function checkAssets(a: { usdcDecimals: number; usdcVersion: string; permit2CodeBytes: number }, pins: NetworkPins): Check[] {
	return [
		check("USDC decimals", a.usdcDecimals === pins.usdcDecimals, `${a.usdcDecimals}`),
		check("USDC EIP-712 version", a.usdcVersion === pins.usdcEip712Version, JSON.stringify(a.usdcVersion)),
		check("Permit2 code", a.permit2CodeBytes > 0, `${a.permit2CodeBytes} bytes`),
	]
}

export function checkSponsor(s: { published: boolean; balance: bigint; budget: bigint }): Check[] {
	return [
		check("SponsoredFPC published", s.published, s.published ? "instance found" : "no instance at the canonical address"),
		check("SponsoredFPC balance ≥ budget", s.published && s.balance >= s.budget, `${s.balance} vs budget ${s.budget}`),
	]
}

const L1_ABI = parseAbi([
	"function getCanonicalRollup() view returns (address)",
	"function getInbox() view returns (address)",
	"function getOutbox() view returns (address)",
	"function getVersion() view returns (uint256)",
	"function decimals() view returns (uint8)",
	"function version() view returns (string)",
])

async function readL1Wiring(l1: PublicClient, pins: NetworkPins): Promise<L1Wiring> {
	const rollup = await l1.readContract({ address: pins.registry, abi: L1_ABI, functionName: "getCanonicalRollup" })
	const [chainId, inbox, outbox, version] = await Promise.all([
		l1.getChainId(),
		l1.readContract({ address: rollup, abi: L1_ABI, functionName: "getInbox" }),
		l1.readContract({ address: rollup, abi: L1_ABI, functionName: "getOutbox" }),
		l1.readContract({ address: rollup, abi: L1_ABI, functionName: "getVersion" }),
	])
	return { chainId, inbox, outbox, version }
}

async function readAssets(l1: PublicClient, pins: NetworkPins) {
	const [usdcDecimals, usdcVersion, code] = await Promise.all([
		l1.readContract({ address: pins.usdc, abi: L1_ABI, functionName: "decimals" }),
		l1.readContract({ address: pins.usdc, abi: L1_ABI, functionName: "version" }),
		l1.getCode({ address: pins.permit2 }),
	])
	return { usdcDecimals, usdcVersion, permit2CodeBytes: code ? (code.length - 2) / 2 : 0 }
}

/** Keyless, read-only: every identity and funding fact a testnet deploy relies on. */
export async function probeNetwork(pins: NetworkPins, l1RpcUrl: string): Promise<Check[]> {
	const node = createAztecNodeClient(pins.nodeUrl)
	const l1 = createPublicClient({ transport: http(l1RpcUrl) }) as PublicClient
	const fpc = AztecAddress.fromStringUnsafe(pins.sponsoredFpc)
	const [info, wiring, assets, fpcInstance, balance, predicted] = await Promise.all([
		node.getNodeInfo(),
		readL1Wiring(l1, pins),
		readAssets(l1, pins),
		node.getContract(fpc),
		getFeeJuiceBalance(fpc, node),
		node.getPredictedMinFees(ManaUsageEstimate.Limit),
	])
	const budget = feeBudget({ txCount: TESTNET_DEPLOY_AND_SMOKE_TXS.length, gasPerTx: ESTIMATED_GAS_PER_TX, predicted, headroom: 3n })
	return [
		...checkNodeIdentity(info, pins),
		...checkL1Wiring(wiring, pins),
		...checkAssets(assets, pins),
		...checkSponsor({ published: fpcInstance !== undefined, balance, budget }),
	]
}
