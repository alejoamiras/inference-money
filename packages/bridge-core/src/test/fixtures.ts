import type { BridgeManifest } from "../manifest"

export const f = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as const
export const a = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as const
const instance = (n: number) => ({
	address: f(n),
	salt: f(n + 1),
	deployer: f(0xd),
	initializer: "constructor",
	constructorArgs: [] as string[],
	publicKeys: "0x00" as const,
	classId: f(n + 2),
})

export const MANIFEST: BridgeManifest = {
	network: "testnet",
	l1: {
		chainId: 11155111,
		usdc: a(1),
		permit2: a(2),
		portal: a(3),
		router: a(4),
		registry: a(5),
		inbox: a(6),
		outbox: a(7),
		deployBlock: 100,
	},
	l2: {
		nodeVersion: "5.0.0",
		rollupVersion: 1821665230,
		nodeUrl: "https://node.example",
		sponsoredFpc: f(0xf),
		proxy: instance(0x10),
		token: instance(0x20),
		bridge: instance(0x30),
	},
}
