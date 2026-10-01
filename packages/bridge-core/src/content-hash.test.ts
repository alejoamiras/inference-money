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

	it("withdraw(0xBEEF, 1_000_000, address(0))", async () => {
		expect(await withdrawContentHash("0xBEEF", 1_000_000n, "0x0")).toBe(
			"0x00ac390e12f1097130e1a7c2e5eea30780cd11d12002b8de22d608cf10a60775",
		)
	})
})
