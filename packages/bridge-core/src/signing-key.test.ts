import { describe, expect, it } from "bun:test"
import { Fr } from "@aztec-labs/aztec.js/fields"
import { signingKeyFor } from "./signing-key"

describe("signingKeyFor", () => {
	it("derives the key every deployed account was built with (the local deployer's, pinned)", () => {
		expect(signingKeyFor(new Fr(0x1a7e0de9107e5n)).toString()).toBe(
			"0x1afe7766a61dfa623e9926fcc143fbc1bca565471b50a25091753b8a576bcb59",
		)
	})
})
