import { describe, expect, it } from "bun:test"
import { mintToPrivateContentHash, mintToPublicContentHash, withdrawContentHash } from "./content-hash"

// The same literals as contracts/evm/test/ContentHash.t.sol and contracts/aztec/keystone.
describe("content hashes (cross-toolchain vectors)", () => {
	it("mint_to_public(0x1234, 1_000_000)", async () => {
		expect(await mintToPublicContentHash("0x1234", 1_000_000n)).toBe(
			"0x00fb464b41c6a08b28bfe9b8a11c1c4dcd2d4c9c66e703988cb76eb00e140dcc",
		)
	})

	it("mint_to_private(1_000_000)", async () => {
		expect(await mintToPrivateContentHash(1_000_000n)).toBe("0x00009b1ee836fa551bb50bb45e2c8e698cc680c6e68e429370625119a2c63954")
	})

	it("withdraw(0xBEEF, 1_000_000, address(0))", async () => {
		expect(await withdrawContentHash("0xBEEF", 1_000_000n, "0x0")).toBe(
			"0x00ac390e12f1097130e1a7c2e5eea30780cd11d12002b8de22d608cf10a60775",
		)
	})
})
