import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { StateDir, withStateDir } from "./run-state"

const roots: string[] = []
const root = () => {
	const r = mkdtempSync(join(tmpdir(), "run-state-"))
	roots.push(r)
	return r
}
afterEach(() => {
	for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

describe("StateDir", () => {
	it("lets one live process hold a deployment's state, and leaves other deployments' state free", () => {
		const r = root()
		const held = StateDir.acquire("smoke", "0xb", r)
		expect(() => StateDir.acquire("smoke", "0xb", r)).toThrow(`in use by process ${process.pid}`)
		expect(() => StateDir.acquire("smoke", "0xother", r).release()).not.toThrow()
		held.release()
		expect(() => StateDir.acquire("smoke", "0xb", r).release()).not.toThrow()
	})

	it("survives a crashed holder, and writes owner-only files atomically", async () => {
		const r = root()
		const crashed = StateDir.acquire("smoke", "0xb", r)
		writeFileSync(join(crashed.dir, "lock", "pid"), "999999999")
		await withStateDir(
			"smoke",
			"0xb",
			async (s) => {
				s.write("state.json", { step: "claimed" })
				expect(s.read<{ step: string }>("state.json")).toEqual({ step: "claimed" })
				expect(statSync(join(s.dir, "state.json")).mode & 0o777).toBe(0o600)
				const store = s.paymentStore()
				await store.put("k", { state: "paid", txHash: "0x1" })
				expect(await store.get("k")).toEqual({ state: "paid", txHash: "0x1" })
			},
			r,
		)
		expect(() => StateDir.acquire("smoke", "0xb", r).release()).not.toThrow()
	})
})
