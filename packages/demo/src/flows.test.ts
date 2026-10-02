import { describe, expect, it } from "bun:test"
import { DEMO_SEED } from "./amounts"
import { resetAmount } from "./flows"

describe("resetAmount", () => {
	it("refunds alice up to her seed, as far as galactica holds, and nothing once she has it", () => {
		const seed = DEMO_SEED.alice
		expect(resetAmount(seed - 4n, 10n)).toBe(4n)
		expect(resetAmount(seed - 4n, 3n)).toBe(3n)
		expect(resetAmount(seed, 10n)).toBe(0n)
		expect(resetAmount(seed + 1n, 10n)).toBe(0n)
	})
})
