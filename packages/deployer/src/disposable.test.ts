import { afterEach, describe, expect, it } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Writable } from "node:stream"
import { assertOwnerOnly, disposableDestroy, disposableExec, disposableInit } from "./disposable"

const roots: string[] = []
const temp = () => {
	const r = mkdtempSync(join(tmpdir(), "disposable-"))
	roots.push(r)
	return r
}
afterEach(() => {
	for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

/** The secret values `init` wrote: the test reads the file it made, which the agent never does with the real one. */
const secretsIn = (file: string) =>
	readFileSync(file, "utf8")
		.split("\n")
		.filter((l) => /_(PRIVATE_KEY|SECRET)=/.test(l))
		.map((l) => l.slice(l.indexOf("=") + 3).toLowerCase())

function sink() {
	let text = ""
	const stream = new Writable({
		write(chunk, _enc, done) {
			text += String(chunk)
			done()
		},
	})
	return { stream, text: () => text }
}

const CHILD = [
	"-e",
	`const s = process.env.TESTNET_ADMIN_SECRET
console.log(process.argv.some((a) => a.includes(s.slice(2))) ? "argv holds a secret" : "argv clean")
console.log("secret", s, "admin", process.env.TESTNET_ADMIN_ADDRESS, "interim", process.env.BRIDGE_INTERIM_ADMIN)`,
]

describe("the disposable fallback", () => {
	it("init writes three new keys to one owner-only file, never again over it, and returns only their addresses", async () => {
		const file = join(temp(), "disposable", "testnet.env")
		const addresses = await disposableInit(file)
		expect(statSync(file).mode & 0o777).toBe(0o600)
		const secrets = secretsIn(file)
		expect(secrets).toHaveLength(3)
		const shown = JSON.stringify(addresses).toLowerCase()
		expect(secrets.filter((s) => shown.includes(s))).toEqual([])

		const before = readFileSync(file, "utf8")
		await expect(disposableInit(file)).rejects.toThrow("EEXIST")
		expect(readFileSync(file, "utf8")).toBe(before)
	})

	it("exec refuses a looser file, another owner, another checkout and a nested call; its child gets the values by env alone, redacted", async () => {
		const [keys, checkout] = [temp(), temp()]
		const file = join(keys, "testnet.env")
		const { admin } = await disposableInit(file)
		const clean = () => ({ found: false, files: 0, walletDirs: [] })
		const opts = { file, root: checkout, keyedRoot: checkout, scan: clean }

		chmodSync(file, 0o640)
		await expect(disposableExec(["verify", "x"], opts)).rejects.toThrow("mode 0600")
		chmodSync(file, 0o600)
		expect(() => assertOwnerOnly(file, (process.getuid?.() ?? 0) + 1)).toThrow("another user")
		await expect(disposableExec(["verify", "x"], { ...opts, keyedRoot: keys })).rejects.toThrow("keyed worktree")
		await expect(disposableExec(["disposable", "destroy"], opts)).rejects.toThrow("not another disposable")

		const [out, err] = [sink(), sink()]
		const code = await disposableExec(["verify", "x"], { ...opts, argv: () => CHILD, out: out.stream, err: err.stream })
		expect(code, err.text()).toBe(0)
		expect(out.text()).toContain("argv clean")
		expect(out.text()).toContain(`secret [redacted] admin ${admin} interim 1`)
		expect(secretsIn(file).filter((s) => out.text().toLowerCase().includes(s))).toEqual([])

		const leaked = () => ({ found: true, files: 1, walletDirs: [] })
		expect(
			await disposableExec(["verify", "x"], { ...opts, argv: () => CHILD, out: sink().stream, err: sink().stream, scan: leaked }),
		).toBe(1)
	})

	it("destroy removes the keys, but not while a manifest still names their admin", async () => {
		const dir = temp()
		const [file, manifest] = [join(dir, "testnet.env"), join(dir, "testnet.json")]
		const { admin } = await disposableInit(file)
		writeFileSync(manifest, JSON.stringify({ l2: { admin: admin.toString() } }))
		await expect(disposableDestroy(file, manifest)).rejects.toThrow("switch to the owner's admin first")
		expect(existsSync(file)).toBe(true)

		writeFileSync(manifest, JSON.stringify({ l2: { admin: `0x${"0a".repeat(32)}` } }))
		await disposableDestroy(file, manifest)
		expect(existsSync(file)).toBe(false)
	})
})
