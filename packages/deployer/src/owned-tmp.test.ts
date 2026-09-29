import { afterEach, describe, expect, it } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { withOwnedTmpDir } from "./owned-tmp"

const roots: string[] = []
function scratchRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "owned-tmp-test-"))
	roots.push(root)
	return join(root, "wallet-tmp")
}
afterEach(() => {
	for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

describe("withOwnedTmpDir", () => {
	it("confines os.tmpdir() to an owner-only per-pid dir, then removes it and restores TMPDIR, even on a throw", async () => {
		const root = scratchRoot()
		const before = process.env.TMPDIR
		let inside = ""
		await expect(
			withOwnedTmpDir(async () => {
				inside = tmpdir()
				writeFileSync(join(inside, "store.mdb"), "synthetic secret key bytes")
				throw new Error("wallet crashed")
			}, root),
		).rejects.toThrow("wallet crashed")

		expect(inside).toBe(join(root, String(process.pid)))
		expect(statSync(root).mode & 0o777).toBe(0o700)
		expect(existsSync(inside)).toBe(false)
		expect(process.env.TMPDIR).toBe(before)
	})

	it("refuses an overlapping scope without disturbing the active one's store", async () => {
		const root = scratchRoot()
		await withOwnedTmpDir(async () => {
			const store = join(tmpdir(), "store.mdb")
			writeFileSync(store, "synthetic secret key bytes")
			await expect(withOwnedTmpDir(async () => {}, root)).rejects.toThrow("already active")
			expect(existsSync(store)).toBe(true)
			expect(tmpdir()).toBe(join(root, String(process.pid)))
		}, root)
		await withOwnedTmpDir(async () => {}, root)
	})

	it("a failed cleanup surfaces and still frees the scope", async () => {
		const root = scratchRoot()
		const locked = join(root, String(process.pid), "locked")
		await expect(
			withOwnedTmpDir(async () => {
				mkdirSync(locked)
				writeFileSync(join(locked, "store.mdb"), "")
				chmodSync(locked, 0o500)
			}, root),
		).rejects.toThrow(/EACCES/)
		chmodSync(locked, 0o700)
		await withOwnedTmpDir(async () => {}, root)
		expect(existsSync(locked)).toBe(false)
	})

	it("reaps the directories of dead runs and keeps live ones", async () => {
		const root = scratchRoot()
		const dead = Bun.spawnSync(["true"]).pid
		mkdirSync(join(root, String(dead)), { recursive: true })
		mkdirSync(join(root, "1"), { recursive: true })

		await withOwnedTmpDir(async () => {}, root)

		expect(existsSync(join(root, String(dead)))).toBe(false)
		expect(existsSync(join(root, "1"))).toBe(true)
	})
})
