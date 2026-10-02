/**
 * Merges a proving run's timed runs into one report and prints the live-proving decision.
 *
 *   bun e2e/run/proving-report.ts <runs-dir> <out.json>
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { decide, LIMITS_MS, MEMORY_LIMIT_BYTES, medians, type ProvingRun, peakBytes } from "../proving"

const [dir, out] = process.argv.slice(2)
if (!dir || !out) throw new Error("usage: proving-report.ts <runs-dir> <out.json>")
const runs: Record<string, ProvingRun> = {}
for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
	const run = JSON.parse(readFileSync(join(dir, f), "utf8")) as ProvingRun
	runs[run.label] = run
}
const decision = decide(runs)
const summary = Object.fromEntries(Object.entries(runs).map(([l, r]) => [l, { medianMs: medians(r), peakBytes: peakBytes(r) }]))
mkdirSync(dirname(out), { recursive: true })
const report = { date: new Date().toISOString(), limits: { ms: LIMITS_MS, memoryBytes: MEMORY_LIMIT_BYTES }, decision, summary, runs }
writeFileSync(out, `${JSON.stringify(report, null, "\t")}\n`)
for (const [label, s] of Object.entries(summary)) console.log(`[proving] ${label}: ${JSON.stringify(s)}`)
const verdict = decision.live ? "live proving" : "simulate, plus a recorded proof"
console.log(`[proving] ${verdict}${decision.reasons.map((r) => `\n  - ${r}`).join("")}\n[proving] report: ${out}`)
