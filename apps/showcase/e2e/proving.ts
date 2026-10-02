/** The proving harness's record of one timed run, and the live-proving decision over a run's timed runs. */
export type ProvedAction = "transfer" | "open" | "pay"

/** What one timed run (`e2e/specs/proving.spec.ts`) records. */
export interface ProvingRun {
	label: string
	/** `navigator.hardwareConcurrency`: bb.js sizes its thread pool by it, quota or not. */
	cores: number
	isolated: boolean
	/** The run's scope: its `cpu.max`, and the time `cpu.stat` says the quota held it back. */
	cpuMax: string
	throttledUsec: number
	samples: { action: ProvedAction; ms: number; warmup: boolean; txHash: string }[]
	memory: { uaPeakBytes: number; uaSamples: number; rendererPeakBytes: number; scopePeakBytes: number }
}

/** Live proving needs every step's median under its run's limit, and the page's peak memory under 3 GB. */
export const LIMITS_MS: Record<string, number> = { unconstrained: 90_000, "2-cpu": 240_000 }
export const MEMORY_LIMIT_BYTES = 3e9

export function median(xs: readonly number[]): number {
	if (xs.length === 0) return Number.NaN
	const s = [...xs].sort((a, b) => a - b)
	const mid = Math.floor(s.length / 2)
	return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2
}

/** Per-step medians over the timed samples, and the open-then-pay pair's, which a visitor sees as two clicks. */
export function medians(run: ProvingRun): Record<ProvedAction | "openAndPay", number> {
	const timed = run.samples.filter((s) => !s.warmup)
	const of = (a: ProvedAction) => timed.filter((s) => s.action === a).map((s) => s.ms)
	const pays = of("pay")
	return {
		transfer: median(of("transfer")),
		open: median(of("open")),
		pay: median(pays),
		openAndPay: median(of("open").flatMap((ms, i) => (pays[i] === undefined ? [] : [ms + pays[i]]))),
	}
}

/** The page's peak: the larger of the browser's own measure and the renderer's resident high-water mark. */
export const peakBytes = (run: ProvingRun): number => Math.max(run.memory.uaPeakBytes, run.memory.rendererPeakBytes)

export interface Decision {
	live: boolean
	/** Every limit a run missed, or why a run cannot count; empty when live. */
	reasons: string[]
}

function runReasons(label: string, limit: number, run: ProvingRun | undefined): string[] {
	if (!run) return [`no ${label} run`]
	const reasons: string[] = []
	if (!run.isolated) reasons.push(`${label}: the page was not cross-origin isolated, so bb.js proved on one thread`)
	if (label !== "unconstrained" && run.throttledUsec === 0) {
		reasons.push(`${label}: the quota never held the browser back, so it did not bind; time it on a reference laptop`)
	}
	const m = medians(run)
	for (const step of ["transfer", "open", "pay"] as const) {
		if (!(m[step] <= limit)) reasons.push(`${label}: the ${step} median ${m[step]} ms is over ${limit} ms`)
	}
	if (!(peakBytes(run) <= MEMORY_LIMIT_BYTES)) reasons.push(`${label}: peak memory ${peakBytes(run)} bytes is over 3 GB`)
	return reasons
}

export function decide(runs: Readonly<Record<string, ProvingRun>>): Decision {
	const reasons = Object.entries(LIMITS_MS).flatMap(([label, limit]) => runReasons(label, limit, runs[label]))
	return { live: reasons.length === 0, reasons }
}
