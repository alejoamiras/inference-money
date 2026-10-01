import { afterEach, describe, expect, it } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
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
	writeFileSync(join(repo, "notes.md"), "nothing here\n")
	const roots = { cache: join(root, "cache"), wallets: join(root, "wallets"), skip: [join(root, "cache", "disposable")] }
	mkdirSync(roots.cache)
	return { repo, roots }
}
afterEach(() => {
	for (const d of dirs.splice(0)) {
		chmodSync(d, 0o700)
		rmSync(d, { recursive: true, force: true })
	}
})

describe("scanForSecrets", () => {
	it("finds a run's secret leaked anywhere in the checkout, ignored files included, or the caches; a keyless run looks for none", () => {
		const { repo, roots } = fixture()
		// Where the values belong (the disposable keys) or third-party code sits (installed dependencies) is not a leak.
		for (const dir of [join(roots.cache, "disposable"), join(roots.cache, "keyed", "node_modules", "dep")]) {
			mkdirSync(dir, { recursive: true })
			writeFileSync(join(dir, "file"), SECRETS.TESTNET_ADMIN_SECRET)
		}
		expect(scanForSecrets(repo, NEEDLES, roots)).toMatchObject({ found: false, skipped: 0, walletDirs: [] })

		writeFileSync(join(repo, ".gitignore"), "build/\n")
		mkdirSync(join(repo, "build"))
		writeFileSync(join(repo, "build", "out.json"), `key ${SECRETS.TESTNET_ADMIN_SECRET.slice(2).toUpperCase()}\n`)
		expect(scanForSecrets(repo, NEEDLES, roots).found).toBe(true)
		expect(scanForSecrets(repo, [], roots).found).toBe(false)

		rmSync(join(repo, "build"), { recursive: true })
		writeFileSync(join(roots.cache, "run.log"), `rpc ${SECRETS.SEPOLIA_RPC_URL}\n`)
		expect(scanForSecrets(repo, NEEDLES, roots).found).toBe(true)
	})

	it("finds a needle straddling a read boundary of a large file, and counts what it cannot read", () => {
		const { repo, roots } = fixture()
		const big = Buffer.alloc(8 * 1024 * 1024 + 64, "a")
		big.write(SECRETS.TESTNET_L1_PRIVATE_KEY, 8 * 1024 * 1024 - 20, "latin1")
		writeFileSync(join(roots.cache, "big.bin"), big)
		expect(scanForSecrets(repo, NEEDLES, roots).found).toBe(true)

		rmSync(join(roots.cache, "big.bin"))
		mkdirSync(join(roots.cache, "locked"))
		chmodSync(join(roots.cache, "locked"), 0o000)
		expect(scanForSecrets(repo, NEEDLES, roots)).toMatchObject({ found: false, skipped: process.getuid?.() === 0 ? 0 : 1 })
		chmodSync(join(roots.cache, "locked"), 0o700)
	})

	it("reports a wallet store left on disk", () => {
		const { repo, roots } = fixture()
		mkdirSync(join(roots.wallets, "4242"), { recursive: true })
		expect(scanForSecrets(repo, [], roots).walletDirs).toEqual(["4242"])
	})
})
