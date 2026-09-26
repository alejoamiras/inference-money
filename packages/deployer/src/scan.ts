import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { WALLET_TMP_ROOT } from "./owned-tmp"
import { containsSecret, type TestnetSecrets } from "./secrets"

/** Every run's caches (logs, smoke state, forge output) live here; wallet stores only transiently, in WALLET_TMP_ROOT. */
const CACHE_ROOT = join(homedir(), ".cache", "inference-money")
const MAX_BYTES = 64 * 1024 * 1024

export interface ScanResult {
	found: boolean
	files: number
	/** Wallet/PXE store dirs still on disk; any is a teardown leak. */
	walletDirs: string[]
}

function filesUnder(dir: string): string[] {
	if (!existsSync(dir)) return []
	return readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((e) => e.isFile())
		.map((e) => join(e.parentPath, e.name))
}

/** The checkout's tracked and unignored files (never `.env.testnet`, which is ignored), plus every cache file. */
function scanTargets(repoRoot: string, cacheRoot: string): string[] {
	const listed = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
		cwd: repoRoot,
		encoding: "utf8",
	})
	const repo = listed
		.split("\0")
		.filter(Boolean)
		.map((f) => join(repoRoot, f))
	return [...repo, ...filesUnder(cacheRoot)].filter((f) => existsSync(f) && statSync(f).size <= MAX_BYTES)
}

/** Answers only whether any secret value appears anywhere it must not, never which one or where. */
export function scanForSecrets(
	repoRoot: string,
	secrets: TestnetSecrets,
	roots = { cache: CACHE_ROOT, wallets: WALLET_TMP_ROOT },
): ScanResult {
	const targets = scanTargets(repoRoot, roots.cache)
	const found = targets.some((f) => containsSecret(readFileSync(f, "latin1"), secrets))
	const walletDirs = existsSync(roots.wallets) ? readdirSync(roots.wallets) : []
	return { found, files: targets.length, walletDirs }
}
