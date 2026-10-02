/**
 * One timed run of the page's proving check, recorded for `e2e/run/proving-report.ts`. It runs inside the systemd scope
 * `e2e/proving.sh` made for it, so the scope's cgroup holds exactly this runner, its browser and the preview server.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Page, test } from "@playwright/test"
import { runEnv } from "../env"
import type { ProvedAction, ProvingRun } from "../proving"

const RUN_TIMEOUT_MS = 120 * 60_000

function scopeFile(file: string): string {
	const line = readFileSync("/proc/self/cgroup", "utf8")
		.split("\n")
		.find((l) => l.startsWith("0::"))
	if (!line) throw new Error("the proving harness needs a cgroup v2 host")
	return readFileSync(`/sys/fs/cgroup${line.slice(3)}/${file}`, "utf8").trim()
}

/** The scope's renderers' resident high-water mark: the page and every worker it proves in live in one of them. */
function rendererPeakBytes(): number {
	let peak = 0
	for (const pid of scopeFile("cgroup.procs").split("\n")) {
		try {
			if (!readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("--type=renderer")) continue
			const hwm = readFileSync(`/proc/${pid}/status`, "utf8").match(/^VmHWM:\s+(\d+) kB$/m)
			if (hwm) peak = Math.max(peak, Number(hwm[1]) * 1024)
		} catch {
			// The process exited between the listing and the read.
		}
	}
	return peak
}

/** Samples the browser's own measure of the page (workers included) until stopped; each sample waits for a GC. */
function sampleMemory(page: Page): () => Promise<{ peak: number; count: number }> {
	let running = true
	let peak = 0
	let count = 0
	const loop = (async () => {
		while (running) {
			const bytes = await page.evaluate(async () => {
				const p = performance as Performance & { measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }> }
				return p.measureUserAgentSpecificMemory ? (await p.measureUserAgentSpecificMemory()).bytes : -1
			})
			if (bytes < 0) throw new Error("measureUserAgentSpecificMemory needs a cross-origin isolated page")
			peak = Math.max(peak, bytes)
			count++
		}
	})()
	return async () => {
		running = false
		await loop
		return { peak, count }
	}
}

test("the page proves the transfer and the open-and-pay", async ({ page }) => {
	test.setTimeout(RUN_TIMEOUT_MS)
	const env = runEnv()
	await page.goto("/#proving")
	await expect(page.getByTestId("wallet-status")).toHaveAttribute("data-status", "ready", { timeout: 10 * 60_000 })
	const provingEnv = page.getByTestId("proving-env")
	// A bundle built with fake proofs would time simulations; nothing it measures may count.
	await expect(provingEnv).toHaveAttribute("data-proves", "true")
	const cores = Number(await provingEnv.getAttribute("data-cores"))
	const isolated = (await provingEnv.getAttribute("data-isolated")) === "true"

	const stopSampling = sampleMemory(page)
	await page.getByTestId("proving-run").click()
	const state = page.getByTestId("proving-state")
	await expect(state).toHaveAttribute("data-state", /^(done|failed)$/, { timeout: RUN_TIMEOUT_MS - 15 * 60_000 })
	const ua = await stopSampling()
	expect(await state.getAttribute("data-state"), (await state.textContent()) ?? "").toBe("done")

	const samples = await page.getByTestId("proving-sample").evaluateAll((els) =>
		els.map((e) => {
			const d = (e as HTMLElement).dataset
			return {
				action: d.action as ProvedAction,
				ms: Number(d.ms),
				warmup: d.warmup === "true",
				txHash: e.getAttribute("data-tx") ?? "",
			}
		}),
	)
	const run: ProvingRun = {
		label: env.proving ?? "unlabelled",
		cores,
		isolated,
		cpuMax: scopeFile("cpu.max"),
		throttledUsec: Number(scopeFile("cpu.stat").match(/^throttled_usec (\d+)$/m)?.[1] ?? 0),
		samples,
		memory: {
			uaPeakBytes: ua.peak,
			uaSamples: ua.count,
			rendererPeakBytes: rendererPeakBytes(),
			scopePeakBytes: Number(scopeFile("memory.peak")),
		},
	}
	const dir = join(env.stateDir, "proving")
	mkdirSync(dir, { recursive: true })
	writeFileSync(join(dir, `${run.label}.json`), `${JSON.stringify(run, null, "\t")}\n`)
})
