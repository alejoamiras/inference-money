import { describe, expect, it } from "bun:test"
import { TOKEN_REFUSALS, tokenRefusalOf } from "./rules"

const TOKEN_SOURCE = new URL("../../../contracts/aztec/token/src/main.nr", import.meta.url).pathname

describe("token refusals", () => {
	it("each appears verbatim as a string literal in the token's Noir source", async () => {
		const source = await Bun.file(TOKEN_SOURCE).text()
		for (const text of Object.values(TOKEN_REFUSALS)) expect(source, text).toContain(`"${text}"`)
	})

	it("maps an error to the most specific refusal it names", () => {
		expect(tokenRefusalOf(new Error("Assertion failed: Only the merchant admin or guardian 'caller == admin'"))).toBe(
			"notAdminOrGuardian",
		)
		expect(tokenRefusalOf(new Error("Assertion failed: Only the pending merchant admin"))).toBe("notPendingAdmin")
		expect(tokenRefusalOf(new Error("Assertion failed: Only the merchant admin"))).toBe("notAdmin")
		expect(tokenRefusalOf(`Simulation error: ${TOKEN_REFUSALS.payment}`)).toBe("payment")
		expect(tokenRefusalOf(new Error("Balance too low"))).toBeUndefined()
	})
})
