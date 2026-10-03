import { describe, expect, it } from "bun:test"
import { join } from "node:path"

/** What a fresh process with SEED set draws: `Fr.random()` (the hazard) and `randomSecret()`. */
function drawSeeded(): { sdk: string; ours: string } {
	const script = `import { Fr } from "@aztec-labs/aztec.js/fields"
import { randomSecret } from ${JSON.stringify(join(import.meta.dir, "random.ts"))}
console.log(JSON.stringify({ sdk: Fr.random().toString(), ours: randomSecret().toString() }))`
	const r = Bun.spawnSync([process.execPath, "-e", script], { cwd: import.meta.dir, env: { PATH: process.env.PATH ?? "", SEED: "7" } })
	if (r.exitCode !== 0) throw new Error(String(r.stderr))
	return JSON.parse(String(r.stdout).trim().split("\n").at(-1) as string)
}

describe("randomSecret", () => {
	it("stays unpredictable under SEED, where the SDK's own draw repeats", () => {
		const [a, b] = [drawSeeded(), drawSeeded()]
		expect(a.sdk).toBe(b.sdk)
		expect(a.ours).not.toBe(b.ours)
		expect(a.ours).toMatch(/^0x[0-9a-f]{64}$/)
	})
})
