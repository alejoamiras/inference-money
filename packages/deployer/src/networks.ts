import type { Address } from "viem"

/** Everything a live network must match before anything is spent on it. */
export interface NetworkPins {
	name: "testnet"
	nodeUrl: string
	defaultL1RpcUrl: string
	nodeVersion: string
	l1ChainId: number
	rollupVersion: number
	registry: Address
	inbox: Address
	outbox: Address
	usdc: Address
	usdcDecimals: number
	usdcEip712Version: string
	permit2: Address
	sponsoredFpc: `0x${string}`
}

export const TESTNET: NetworkPins = {
	name: "testnet",
	nodeUrl: "https://v5.testnet.rpc.aztec-labs.com",
	defaultL1RpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
	nodeVersion: "5.0.0",
	l1ChainId: 11155111,
	rollupVersion: 1821665230,
	registry: "0xa0bfb1b494fb49041e5c6e8c2c1be09cd171c6ba",
	inbox: "0x3047dbf2b7dd9f58ac41113525480f94745a4f7c",
	outbox: "0x905f80009bbef9d9426675b45009922971ed42ff",
	usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
	usdcDecimals: 6,
	usdcEip712Version: "2",
	permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
	// Canonical SponsoredFPC (salt 0) for the 5.0.0 CLI; its address commits to the contract class.
	sponsoredFpc: "0x0628377e98bca5913dc86765ad0758f7b7aa83eac49079c6fba125807b393fe1",
}

export function networkByName(name: string): NetworkPins {
	if (name === "testnet") return TESTNET
	throw new Error(`unknown network "${name}" (expected: testnet)`)
}
