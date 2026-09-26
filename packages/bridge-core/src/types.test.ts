import { describe, expect, it } from "bun:test"
import type { Account, Address, WalletClient } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { type L1Ctx, signerOf } from "./types"

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
