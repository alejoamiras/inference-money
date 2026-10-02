// @vitest-environment node
import { describe, expect, it } from "vitest"
import { decide, medians, type ProvingRun } from "./proving"

const sample = (action: "transfer" | "open" | "pay", ms: number, warmup = false) => ({ action, ms, warmup, txHash: "0x" })

function run(label: string, ms: number, extra: Partial<ProvingRun> = {}): ProvingRun {
	return {
		label,
		cores: 12,
		isolated: true,
		cpuMax: label === "unconstrained" ? "max 100000" : "200000 100000",
		throttledUsec: label === "unconstrained" ? 0 : 1_000,
		samples: [
			sample("transfer", 10 * ms, true),
			...[ms, ms + 1, ms - 1].map((t) => sample("transfer", t)),
			...[1, 2, 3].flatMap((i) => [sample("open", ms + i), sample("pay", ms)]),
		],
		memory: { uaPeakBytes: 1e9, uaSamples: 3, rendererPeakBytes: 2e9, scopePeakBytes: 2.5e9 },
		...extra,
	}
}

describe("the live-proving decision", () => {
	it("takes per-step medians over the timed samples only", () => {
		expect(medians(run("unconstrained", 50_000))).toEqual({ transfer: 50_000, open: 50_002, pay: 50_000, openAndPay: 100_002 })
	})

	it("goes live only with every step under its run's limit, peak memory under 3 GB and a quota that bound", () => {
		expect(decide({ unconstrained: run("unconstrained", 80_000), "2-cpu": run("2-cpu", 200_000) })).toEqual({ live: true, reasons: [] })
		const slow = decide({ unconstrained: run("unconstrained", 95_000), "2-cpu": run("2-cpu", 200_000, { throttledUsec: 0 }) })
		expect(slow.live).toBe(false)
		expect(slow.reasons).toEqual([
			"unconstrained: the transfer median 95000 ms is over 90000 ms",
			"unconstrained: the open median 95002 ms is over 90000 ms",
			"unconstrained: the pay median 95000 ms is over 90000 ms",
			"2-cpu: the quota never held the browser back, so it did not bind; time it on a reference laptop",
		])
		const heavy = run("2-cpu", 200_000, { memory: { uaPeakBytes: 3.2e9, uaSamples: 3, rendererPeakBytes: 1e9, scopePeakBytes: 4e9 } })
		expect(decide({ unconstrained: run("unconstrained", 80_000), "2-cpu": heavy }).reasons).toEqual([
			"2-cpu: peak memory 3200000000 bytes is over 3 GB",
		])
		expect(decide({ unconstrained: run("unconstrained", 80_000) }).reasons).toEqual(["no 2-cpu run"])
	})
})
