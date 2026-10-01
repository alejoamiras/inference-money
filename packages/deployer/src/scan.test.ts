import { afterEach, describe, expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { scanForSecrets } from "./scan"
import { secretNeedles } from "./secrets"

const SECRETS = {
	TESTNET_L1_PRIVATE_KEY: `0x${"ab".repeat(32)}`,
	TESTNET_ADMIN_SECRET: `0x${"0c".repeat(32)}`,
	SEPOLIA_RPC_URL: "https://rpc.example/key-123",
}
const NEEDLES = secretNeedles(SECRETS)

const dirs: string[] = []
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "scan-test-"))
	dirs.push(root)
	const repo = join(root, "repo")
	mkdirSync(repo)
	execFileSync("git", ["init", "-q"], { cwd: repo })
	writeFileSync(join(repo, "notes.md"), "nothing here\n")
	const roots = { cache: join(root, "cache"), wallets: join(root, "wallets"), skip: [join(root, "cache", "disposable")] }
	mkdirSync(roots.cache)
	return { repo, roots }
}
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe("scanForSecrets", () => {
	it("finds a run's secret leaked into the checkout or the caches, and in a keyless run looks for none", () => {
		const { repo, roots } = fixture()
		// Where the values belong (the disposable keys) or third-party code sits (installed dependencies) is not a leak.
		for (const dir of [join(roots.cache, "disposable"), join(roots.cache, "keyed", "node_modules", "dep")]) {
			mkdirSync(dir, { recursive: true })
			writeFileSync(join(dir, "file"), SECRETS.TESTNET_ADMIN_SECRET)
		}
		expect(scanForSecrets(repo, NEEDLES, roots)).toMatchObject({ found: false, walletDirs: [] })

		writeFileSync(join(repo, "notes.md"), `key ${SECRETS.TESTNET_ADMIN_SECRET.slice(2).toUpperCase()}\n`)
		expect(scanForSecrets(repo, NEEDLES, roots).found).toBe(true)
		expect(scanForSecrets(repo, [], roots).found).toBe(false)

		writeFileSync(join(repo, "notes.md"), "clean again\n")
		writeFileSync(join(roots.cache, "run.log"), `rpc ${SECRETS.SEPOLIA_RPC_URL}\n`)
		expect(scanForSecrets(repo, NEEDLES, roots).found).toBe(true)
	})

	it("reports a wallet store left on disk", () => {
		const { repo, roots } = fixture()
		mkdirSync(join(roots.wallets, "4242"), { recursive: true })
		expect(scanForSecrets(repo, [], roots).walletDirs).toEqual(["4242"])
	})
})
