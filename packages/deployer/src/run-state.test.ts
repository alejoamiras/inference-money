import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { StateDir, takeOverStaleLock, withStateDir } from "./run-state"

/** Above every platform's pid range, so never alive. */
const DEAD = 999_999_999

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

	it("takes over a crashed holder's lock, and writes owner-only files atomically", async () => {
		const r = root()
		const crashed = StateDir.acquire("smoke", "0xb", r)
		writeFileSync(join(crashed.dir, "lock"), String(DEAD))
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

	it("never removes a live holder's lock: a takeover that lost the race puts it back, and release leaves it", () => {
		const r = root()
		const s = StateDir.acquire("smoke", "0xb", r)
		const lock = join(s.dir, "lock")
		// Another process replaced the dead holder's lock after this one read it.
		takeOverStaleLock(lock, DEAD)
		expect(readFileSync(lock, "utf8")).toBe(String(process.pid))

		writeFileSync(lock, "1")
		s.release()
		expect(() => StateDir.acquire("smoke", "0xb", r)).toThrow("in use by process 1")
		writeFileSync(lock, "garbage")
		expect(() => StateDir.acquire("smoke", "0xb", r)).toThrow("names no process")
	})
})
