import { describe, expect, it } from "bun:test"
import { isUserRejection } from "./errors"

describe("isUserRejection", () => {
	it("matches explicit refusals anywhere in the cause chain, and nothing ambiguous", () => {
		expect(isUserRejection(new Error("wrapped", { cause: { code: 4001 } }))).toBe(true)
		expect(isUserRejection({ name: "UserRejectedRequestError" })).toBe(true)
		expect(isUserRejection(new Error("Transaction rejected by user"))).toBe(true)
		expect(isUserRejection(new Error("fetch failed"))).toBe(false)
		expect(isUserRejection(new Error("rejected"))).toBe(false)
	})
})
