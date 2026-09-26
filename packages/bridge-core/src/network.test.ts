import { describe, expect, it } from "bun:test"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Fr } from "@aztec/aztec.js/fields"
import type { PublicClient, WalletClient } from "viem"
import { assertNetworkIdentity, assertSigningContext, NetworkMismatchError, walletChainIdOf } from "./network"
import { MANIFEST as M } from "./test/fixtures"

const ROLLUP = "0x00000000000000000000000000000000000000cc"

function l1Reads(over: Partial<Record<string, unknown>> = {}): PublicClient {
	const reads: Record<string, unknown> = {
		getCanonicalRollup: ROLLUP,
		getInbox: M.l1.inbox.toUpperCase().replace("0X", "0x"),
		getOutbox: M.l1.outbox,
		getVersion: BigInt(M.l2.rollupVersion),
		...over,
	}
	return {
		getChainId: async () => (over.chainId as number | undefined) ?? M.l1.chainId,
		readContract: async ({ functionName }: { functionName: string }) => reads[functionName],
	} as unknown as PublicClient
}

const node = (over: Record<string, unknown> = {}) => ({
	getNodeInfo: async () => ({
		nodeVersion: M.l2.nodeVersion,
		l1ChainId: M.l1.chainId,
		rollupVersion: M.l2.rollupVersion,
		l1ContractAddresses: { registryAddress: M.l1.registry, inboxAddress: M.l1.inbox, outboxAddress: M.l1.outbox },
		...over,
	}),
})

describe("walletChainIdOf", () => {
	it("is testnet's wallet-visible id, never the bare rollup version", () => {
		expect(walletChainIdOf(11155111, 1821665230)).toBe(1816023401)
		expect(walletChainIdOf(11155111, 1821665230)).not.toBe(1821665230)
		expect(walletChainIdOf(0xffffffff, 1)).toBeGreaterThan(0)
	})
})

describe("assertNetworkIdentity", () => {
	it("passes on the manifest's network (addresses compared case-insensitively)", async () => {
		await assertNetworkIdentity(node(), l1Reads(), M)
	})

	it.each([
		["node version", node({ nodeVersion: "5.0.1" }), l1Reads()],
		["node rollup", node({ rollupVersion: 1 }), l1Reads()],
		["L1 chain", node(), l1Reads({ chainId: 1 })],
		["canonical rollup outbox", node(), l1Reads({ getOutbox: "0x00000000000000000000000000000000000000ee" })],
		["canonical rollup version", node(), l1Reads({ getVersion: 1n })],
	])("refuses a different %s", async (_, n, l1) => {
		await expect(assertNetworkIdentity(n, l1, M)).rejects.toBeInstanceOf(NetworkMismatchError)
	})
})

describe("assertSigningContext", () => {
	const account = "0x00000000000000000000000000000000000000aa" as const
	const l2Account = AztecAddress.fromBigIntUnsafe(7n)
	const l1 = (chainId: number, selected: string) => ({
		publicClient: l1Reads(),
		walletClient: { getChainId: async () => chainId, getAddresses: async () => [selected] } as unknown as WalletClient,
		account,
	})
	const aztec = (version: number, accounts: AztecAddress[]) => ({
		getChainInfo: async () => ({ chainId: new Fr(M.l1.chainId), version: new Fr(version) }),
		getAccounts: async () => accounts.map((item) => ({ item })),
	})

	it("passes when both wallets are on the reviewed chains and accounts", async () => {
		await assertSigningContext(l1(M.l1.chainId, account), aztec(M.l2.rollupVersion, [l2Account]), M, { l1Account: account, l2Account })
	})

	it("refuses a switched L1 chain or account, and a different Aztec rollup or account", async () => {
		const ok = aztec(M.l2.rollupVersion, [l2Account])
		for (const [ctx, wallet] of [
			[l1(1, account), ok],
			[l1(M.l1.chainId, "0x00000000000000000000000000000000000000bb"), ok],
			[l1(M.l1.chainId, account), aztec(1, [l2Account])],
			[l1(M.l1.chainId, account), aztec(M.l2.rollupVersion, [])],
		] as const) {
			await expect(assertSigningContext(ctx, wallet, M, { l1Account: account, l2Account })).rejects.toBeInstanceOf(
				NetworkMismatchError,
			)
		}
	})
})
