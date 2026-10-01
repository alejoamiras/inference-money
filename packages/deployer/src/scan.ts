import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join, sep } from "node:path"
import { WALLET_TMP_ROOT } from "./owned-tmp"
import { DISPOSABLE_DIR } from "./run-state"
import { containsSecret } from "./secrets"

/** Every run's caches (logs, smoke state, forge output) live here; wallet stores only transiently, in WALLET_TMP_ROOT. */
const CACHE_ROOT = join(homedir(), ".cache", "inference-money")
const MAX_BYTES = 64 * 1024 * 1024

export interface ScanResult {
	found: boolean
	files: number
	/** Wallet/PXE store dirs still on disk; any is a teardown leak. */
	walletDirs: string[]
}

const under = (path: string, dir: string) => path === dir || path.startsWith(`${dir}${sep}`)
const DEPENDENCIES = `${sep}node_modules`
const inDependencies = (path: string) => path.endsWith(DEPENDENCIES) || path.includes(`${DEPENDENCIES}${sep}`)

function filesUnder(dir: string, skip: readonly string[]): string[] {
	if (!existsSync(dir)) return []
	return readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((e) => e.isFile() && !inDependencies(e.parentPath) && !skip.some((s) => under(e.parentPath, s)))
		.map((e) => join(e.parentPath, e.name))
}

/** The checkout's tracked and unignored files, plus every cache file outside `skip`. */
function scanTargets(repoRoot: string, cacheRoot: string, skip: readonly string[]): string[] {
	const listed = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
		cwd: repoRoot,
		encoding: "utf8",
	})
	const repo = listed
		.split("\0")
		.filter(Boolean)
		.map((f) => join(repoRoot, f))
	return [...repo, ...filesUnder(cacheRoot, skip)].filter((f) => existsSync(f) && statSync(f).size <= MAX_BYTES)
}

/**
 * Answers only whether any needle (`secretNeedles` of the keyed run's own environment) appears anywhere it must not,
 * never which one or where. A keyless run has no needles, so it checks only for wallet stores left on disk. The cache
 * scan skips installed dependencies (third-party, installed keylessly before any run) and the disposable keys' own
 * directory, which holds them by design.
 */
export function scanForSecrets(
	repoRoot: string,
	needles: readonly string[],
	roots = { cache: CACHE_ROOT, wallets: WALLET_TMP_ROOT, skip: [DISPOSABLE_DIR] },
): ScanResult {
	const targets = scanTargets(repoRoot, roots.cache, roots.skip)
	const found = needles.length > 0 && targets.some((f) => containsSecret(readFileSync(f, "latin1"), needles))
	const walletDirs = existsSync(roots.wallets) ? readdirSync(roots.wallets) : []
	return { found, files: targets.length, walletDirs }
}
