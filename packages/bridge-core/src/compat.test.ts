import { describe, expect, it } from "bun:test"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { FunctionSelector } from "@aztec/stdlib/abi"
import { authorizeLegacyHandshakeReads, legacyHandshakeRegistry } from "./compat"

describe("5.0.0 HandshakeRegistry shim", () => {
	it("derives the address aztec-nr 5.0.0 bakes in, and authorizes only its two reads", async () => {
		const registry = (await legacyHandshakeRegistry()).address
		expect(registry.toString()).toBe("0x0193c31bd24d0347aa9ed889cd6d304832988625c2f21c411e7af9d703591aa5")

		const read = FunctionSelector.fromString("0xc475a0eb") // get_non_interactive_handshakes, the call the SponsoredFPC makes
		const write = await FunctionSelector.fromSignature("non_interactive_handshake((Field),(Field))")
		expect(await authorizeLegacyHandshakeReads({ target: registry, functionSelector: read })).toEqual({ authorized: true })
		expect((await authorizeLegacyHandshakeReads({ target: registry, functionSelector: write })).authorized).toBe(false)
		expect((await authorizeLegacyHandshakeReads({ target: await AztecAddress.random(), functionSelector: read })).authorized).toBe(
			false,
		)
	})
})
