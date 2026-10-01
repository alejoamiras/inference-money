import { describe, expect, it } from "vitest"
import { itemValue, signedUsdc, usdc2 } from "./format"

describe("format", () => {
	it("keeps every USDC digit and at least two decimals, signed when it is a move", () => {
		expect([usdc2(10_000_000n), usdc2(1n), usdc2(1_234_567_000_000n)]).toEqual(["10.00", "0.000001", "1,234,567.00"])
		expect([signedUsdc(7_000_000n), signedUsdc(-3_000_000n), signedUsdc(0n)]).toEqual(["+7.00", "−3.00", "0.00"])
	})

	it("reads a public field in its unit: USDC, a UTC time, a grouped count, a short address", () => {
		const item = (label: string, value: string) => itemValue({ chain: "aztec", label, value, visibility: "readable" })
		expect(item("amount", "3000000")).toBe("3.00 USDC")
		expect(item("expires at", "1790920404")).toBe("05:53 UTC")
		expect(item("fee", "6054340000000")).toBe("0.000006054 fee juice")
		expect(item("nullifiers", "123456789")).toBe("123,456,789")
		expect(item("fee payer", `0x${"ab".repeat(32)}`)).toBe("0xabab…abab")
		expect(item("kind", "private")).toBe("private")
	})
})
