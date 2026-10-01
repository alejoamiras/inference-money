import { afterEach, describe, expect, it } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Writable } from "node:stream"
import { Fr } from "@aztec-labs/aztec.js/fields"
import { MANIFEST } from "../../bridge-core/src/test/fixtures"
import { assertOwnerOnly, disposableDestroy, disposableExec, disposableInit } from "./disposable"
import type { Roles } from "./token-reads"

const someone = new Fr(0x5eedn)
const NOBODY: Roles = { owner: someone, pendingOwner: Fr.ZERO, admin: someone, pendingAdmin: Fr.ZERO }

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
console.log("secret", s, "l1", process.env.TESTNET_L1_PRIVATE_KEY ?? "absent", "interim", process.env.BRIDGE_INTERIM_ADMIN)`,
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

	it("exec refuses a looser file, another owner, another checkout and a nested call; its child gets only its command's values, by env, redacted", async () => {
		const [keys, checkout] = [temp(), temp()]
		const file = join(keys, "testnet.env")
		await disposableInit(file)
		const clean = () => ({ found: false, files: 0, skipped: 0, walletDirs: [] })
		const opts = { file, root: checkout, keyedRoot: checkout, scan: clean }

		chmodSync(file, 0o640)
		await expect(disposableExec(["verify", "x"], opts)).rejects.toThrow("mode 0600")
		chmodSync(file, 0o600)
		expect(() => assertOwnerOnly(file, (process.getuid?.() ?? 0) + 1)).toThrow("another user")
		await expect(disposableExec(["verify", "x"], { ...opts, keyedRoot: keys })).rejects.toThrow("keyed worktree")
		await expect(disposableExec(["disposable", "destroy", "x"], opts)).rejects.toThrow("not another disposable")

		const accept = ["admin", "accept", "x"]
		const [out, err] = [sink(), sink()]
		const code = await disposableExec(accept, { ...opts, argv: () => CHILD, out: out.stream, err: err.stream })
		expect(code, err.text()).toBe(0)
		expect(out.text()).toContain("argv clean")
		expect(out.text()).toContain("secret [redacted] l1 absent interim 1")
		expect(secretsIn(file).filter((s) => out.text().toLowerCase().includes(s))).toEqual([])

		const leaked = () => ({ found: true, files: 1, skipped: 0, walletDirs: [] })
		expect(await disposableExec(accept, { ...opts, argv: () => CHILD, out: sink().stream, err: sink().stream, scan: leaked })).toBe(1)
	})

	it("destroy removes the keys only once neither disposable account holds or is offered a role", async () => {
		const file = join(temp(), "testnet.env")
		const { deployer, admin } = await disposableInit(file)
		const ref = { path: "testnet.json", m: MANIFEST }
		const roles = (r: Partial<Roles>) => async (): Promise<Roles> => ({ ...NOBODY, ...r })

		await expect(disposableDestroy(ref, { file, roles: roles({ pendingAdmin: admin.toField() }) })).rejects.toThrow("pendingAdmin")
		await expect(disposableDestroy(ref, { file, roles: roles({ owner: deployer.toField() }) })).rejects.toThrow("owner")
		expect(existsSync(file)).toBe(true)

		await disposableDestroy(ref, { file, roles: roles({}) })
		expect(existsSync(file)).toBe(false)
	})
})
