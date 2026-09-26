import { describe, expect, it } from "bun:test"
import { computeProgress, PROGRESS_CAP } from "./progress"

describe("computeProgress: block-based (L2->L1)", () => {
	it("reports blocks remaining, a fraction and an ETA mid-wait", () => {
		const p = computeProgress({ startBlock: 100, provenBlock: 110, neededBlock: 120, elapsedMs: 0, maxWaitMs: 0, secondsPerBlock: 60 })
		expect(p.blocksRemaining).toBe(10)
		expect(p.fillFraction).toBeCloseTo(0.5, 5)
		expect(p.label).toBe("10 blocks remaining (~10 min)")
		expect(p.done).toBe(false)
	})

	it("caps below full with one block left, then is done once proven reaches the needed block", () => {
		const almost = computeProgress({ startBlock: 100, provenBlock: 119, neededBlock: 120, elapsedMs: 0, maxWaitMs: 0 })
		expect(almost.label).toMatch(/^1 block remaining/)
		expect(almost.fillFraction).toBeLessThanOrEqual(PROGRESS_CAP)
		const done = computeProgress({ startBlock: 100, provenBlock: 120, neededBlock: 120, elapsedMs: 0, maxWaitMs: 0 })
		expect(done).toMatchObject({ fillFraction: 1, done: true, blocksRemaining: 0 })
	})
})

describe("computeProgress: time-based (L1->L2)", () => {
	it("fills with elapsed/maxWait", () => {
		const p = computeProgress({ elapsedMs: 60_000, maxWaitMs: 240_000 })
		expect(p.fillFraction).toBeCloseTo(0.25, 5)
		expect(p.label).toBe("~3 min remaining")
	})

	it("never reads done on an overrun, and is indeterminate with no bound", () => {
		expect(computeProgress({ elapsedMs: 999_000, maxWaitMs: 240_000 })).toMatchObject({ fillFraction: PROGRESS_CAP, done: false })
		expect(computeProgress({ elapsedMs: 10_000, maxWaitMs: 0 })).toMatchObject({ indeterminate: true, fillFraction: 0 })
	})
})
