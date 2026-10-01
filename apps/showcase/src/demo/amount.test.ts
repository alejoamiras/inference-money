// @vitest-environment node
import { describe, expect, it } from "vitest"
import { formatUsdc, parseUsdc } from "./amount"

describe("parseUsdc", () => {
	it("takes exact decimal text up to six places", () => {
		expect(parseUsdc(" 12.5 ")).toEqual({ ok: true, value: 12_500_000n })
		expect(parseUsdc("0.000001")).toEqual({ ok: true, value: 1n })
		expect(parseUsdc("340282366920938463463374607431768.211455")).toEqual({ ok: true, value: 2n ** 128n - 1n })
	})

	it.each([
		["", "Enter"],
		["1.2345678", "6 decimal"],
		["0", "more than zero"],
		["0.000000", "more than zero"],
		["-1", "digits"],
		["1e6", "digits"],
		["1,000", "digits"],
		[".5", "digits"],
		["5.", "digits"],
		["0x10", "digits"],
		["340282366920938463463374607431768.211456", "too large"],
	])("refuses %j", (text, error) => {
		const r = parseUsdc(text)
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.error).toContain(error)
	})
})

describe("formatUsdc", () => {
	it("shows every significant digit and nothing more", () => {
		expect(formatUsdc(1_234_567n)).toBe("1.234567")
		expect(formatUsdc(1_000_000n)).toBe("1")
		expect(formatUsdc(1n)).toBe("0.000001")
		expect(formatUsdc(1_234_000_500_000n)).toBe("1,234,000.5")
	})
})
