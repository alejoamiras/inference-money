import { describe, expect, it } from "bun:test"
import { mintToPrivateContentHash, mintToPublicContentHash, withdrawContentHash } from "./content-hash"

// The same literals as contracts/evm/test/ContentHash.t.sol and contracts/aztec/keystone.
describe("content hashes (cross-toolchain vectors)", () => {
	it("mint_to_public(0x1234, 1_000_000, 0xD0D0)", async () => {
		expect(await mintToPublicContentHash("0x1234", 1_000_000n, "0xD0D0")).toBe(
			"0x00dbc90158731bb184636b606f4a34496eb320d1215f259c4c53afeea7629e23",
		)
	})

	it("mint_to_private(1_000_000, 0xD0D0)", async () => {
		expect(await mintToPrivateContentHash(1_000_000n, "0xD0D0")).toBe(
			"0x006bfc126e408142a4cc801b6780b5c8c7ad7bfc7cb23d1a2cbb731a958c2a07",
		)
	})

	// The top bit of every word set: an encoder that truncates an address or amount still matches the low vectors.
	const HIGH_DEPOSITOR = "0x8000000000000000000000000000000000000001"

	it("mint_to_public(0x1234, 2^127, 0x8000…0001)", async () => {
		expect(await mintToPublicContentHash("0x1234", 2n ** 127n, HIGH_DEPOSITOR)).toBe(
			"0x00c92584ad559f46de9851f17d4c3d591df8dd99278eaa8dd7d568af0b076685",
		)
	})

	it("mint_to_private(2^128 - 1, 0x8000…0001)", async () => {
		expect(await mintToPrivateContentHash(2n ** 128n - 1n, HIGH_DEPOSITOR)).toBe(
			"0x0027e4159023e23580ae653c0c0cc3ea532ec740f7f9cee719433a8674acd365",
		)
	})

	it("withdraw(0xBEEF, 1_000_000, address(0))", async () => {
		expect(await withdrawContentHash("0xBEEF", 1_000_000n, "0x0")).toBe(
			"0x00ac390e12f1097130e1a7c2e5eea30780cd11d12002b8de22d608cf10a60775",
		)
	})
})
