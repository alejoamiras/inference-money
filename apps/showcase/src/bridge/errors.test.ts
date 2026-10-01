import { describe, expect, it } from "vitest"
import { normalizeError, userMessage } from "./errors"

const envelope = (code: string) => JSON.stringify({ data: { walletErrorCode: code } })

describe("normalizeError", () => {
	it("the structured envelope code wins over any text the message also carries", () => {
		const err = new Error(JSON.stringify({ data: { walletErrorCode: "PXE_STALE_ANCHOR" }, message: "user rejected the request" }))
		expect(normalizeError(err).category).toBe("chain-desync")
		expect(normalizeError(new Error(JSON.stringify(envelope("CONTRACT_NOT_REGISTERED")))).category).toBe("contract-not-registered")
	})

	it("a capability denial is not a generic user rejection", () => {
		expect(normalizeError(new Error("Capability denied by user")).category).toBe("capability-rejected")
		expect(normalizeError(new Error("User rejected the request")).category).toBe("user-rejected")
		expect(normalizeError({ code: 4001, message: "" }).category).toBe("user-rejected")
	})

	it("a prototype-key code maps to nothing", () => {
		const out = normalizeError(new Error(envelope("toString")))
		expect(out.category).toBe("unknown")
	})

	it("classifies the remaining wordings in order and falls back to the error's own text", () => {
		expect(normalizeError(new Error("No wallet found")).category).toBe("no-wallet")
		expect(normalizeError(new Error("Existing nullifier for account")).category).toBe("account-uninitialized")
		expect(normalizeError(new Error("Sponsored fee payment failed")).category).toBe("no-fee-asset")
		expect(normalizeError(new Error("execution reverted")).category).toBe("tx-reverted")
		expect(normalizeError(new Error("Unknown contract 0x1")).category).toBe("contract-not-registered")
		expect(normalizeError(new Error("Failed to fetch")).category).toBe("network")
		expect(normalizeError(new Error("something odd"))).toMatchObject({ category: "unknown", message: "something odd" })
		expect(normalizeError({ cause: { message: "ECONNREFUSED" } }).category).toBe("network")
	})
})

describe("userMessage", () => {
	it("prefers details, then shortMessage, then message, then the fallback", () => {
		expect(userMessage({ details: "d", shortMessage: "s", message: "m" }, "f")).toBe("d")
		expect(userMessage({ shortMessage: "s", message: "m" }, "f")).toBe("s")
		expect(userMessage(new Error("m"), "f")).toBe("m")
		expect(userMessage(new Error("   "), "f")).toBe("f")
		expect(userMessage(undefined, "f")).toBe("f")
	})
})
