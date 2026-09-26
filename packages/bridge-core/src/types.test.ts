import { describe, expect, it } from "bun:test"
import type { Account, Address, WalletClient } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { sepolia } from "viem/chains"
import { type L1Ctx, sendChain, signerOf } from "./types"

const ctx = (own: Account | undefined, account: Address) => ({ walletClient: { account: own } as WalletClient, account }) as L1Ctx

describe("signerOf", () => {
	it("signs with the wallet's own key only when it is the pinned account, else names the address", () => {
		const key = privateKeyToAccount(generatePrivateKey())
		const other = privateKeyToAccount(generatePrivateKey()).address
		expect(signerOf(ctx(key, key.address))).toBe(key)
		expect(signerOf(ctx(key, other))).toBe(other)
		expect(signerOf(ctx(undefined, key.address))).toBe(key.address)
	})
})

describe("sendChain", () => {
	it("is never null: the wallet's own chain when it is the expected one, else a bare definition of the expected id", () => {
		const onSepolia = { walletClient: { chain: sepolia } as unknown as WalletClient } as L1Ctx
		expect(sendChain(onSepolia, sepolia.id)).toBe(sepolia)
		expect(sendChain(onSepolia, 31337).id).toBe(31337)
		expect(sendChain({ walletClient: {} as WalletClient } as L1Ctx, sepolia.id).id).toBe(sepolia.id)
	})
})
