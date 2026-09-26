import { afterEach, describe, expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { scanForSecrets } from "./scan"
import type { TestnetSecrets } from "./secrets"

const SECRETS: TestnetSecrets = {
	l1PrivateKey: `0x${"ab".repeat(32)}`,
	aztecSecretKey: `0x${"0c".repeat(32)}`,
	sepoliaRpcUrl: "https://rpc.example/key-123",
}

const dirs: string[] = []
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "scan-test-"))
	dirs.push(root)
	const repo = join(root, "repo")
	mkdirSync(repo)
	execFileSync("git", ["init", "-q"], { cwd: repo })
	writeFileSync(join(repo, ".gitignore"), ".env.testnet\n")
	writeFileSync(join(repo, ".env.testnet"), `TESTNET_L1_PRIVATE_KEY=${SECRETS.l1PrivateKey}\n`)
	writeFileSync(join(repo, "notes.md"), "nothing here\n")
	const roots = { cache: join(root, "cache"), wallets: join(root, "wallets") }
	mkdirSync(roots.cache)
	return { repo, roots }
}
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe("scanForSecrets", () => {
	it("never reads the ignored secrets file, and finds a secret leaked into the checkout or the caches", () => {
		const { repo, roots } = fixture()
		expect(scanForSecrets(repo, SECRETS, roots)).toMatchObject({ found: false, walletDirs: [] })

		writeFileSync(join(repo, "notes.md"), `key ${SECRETS.aztecSecretKey.slice(2).toUpperCase()}\n`)
		expect(scanForSecrets(repo, SECRETS, roots).found).toBe(true)

		writeFileSync(join(repo, "notes.md"), "clean again\n")
		writeFileSync(join(roots.cache, "run.log"), `rpc ${SECRETS.sepoliaRpcUrl}\n`)
		expect(scanForSecrets(repo, SECRETS, roots).found).toBe(true)
	})

	it("reports a wallet store left on disk", () => {
		const { repo, roots } = fixture()
		mkdirSync(join(roots.wallets, "4242"), { recursive: true })
		expect(scanForSecrets(repo, SECRETS, roots).walletDirs).toEqual(["4242"])
	})
})
