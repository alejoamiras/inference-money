import { closeSync, type Dirent, existsSync, openSync, readdirSync, readSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { WALLET_TMP_ROOT } from "./owned-tmp"
import { DISPOSABLE_DIR } from "./run-state"
import { containsSecret } from "./secrets"

/** Every run's caches (logs, smoke state, forge output, the keyed worktree) live here; wallet stores only transiently. */
const CACHE_ROOT = join(homedir(), ".cache", "inference-money")
/** Installed dependencies are third-party and installed keylessly before any run; `.git` holds only compressed objects. */
const PRUNED = new Set(["node_modules", ".git"])
const CHUNK = 8 * 1024 * 1024

export interface ScanResult {
	found: boolean
	files: number
	/** Files or directories the scan could not read; any fails it, since a leak could hide there. */
	skipped: number
	/** Wallet/PXE store dirs still on disk; any is a teardown leak. */
	walletDirs: string[]
}

export const scanFailed = (r: ScanResult): boolean => r.found || r.skipped > 0 || r.walletDirs.length > 0
/** Yes/no and counts only. */
export const scanLine = (r: ScanResult): string =>
	`found=${r.found} files=${r.files} skipped=${r.skipped} walletDirs=${r.walletDirs.length}`

const code = (e: unknown) => (e as NodeJS.ErrnoException).code

interface Walk {
	files: Set<string>
	skipped: number
}

function walk(dir: string, skip: readonly string[], into: Walk): void {
	let entries: Dirent[]
	try {
		entries = readdirSync(dir, { withFileTypes: true })
	} catch (e) {
		if (code(e) !== "ENOENT") into.skipped++
		return
	}
	for (const e of entries) {
		const path = join(dir, e.name)
		if (e.isDirectory() && !PRUNED.has(e.name) && !skip.includes(path)) walk(path, skip, into)
		else if (e.isFile()) into.files.add(path)
	}
}

/** Reads `path` in chunks that overlap by the longest needle, so no needle straddles a boundary unseen. */
function fileContains(path: string, needles: readonly string[]): boolean {
	const overlap = Math.max(...needles.map((n) => n.length)) - 1
	const buf = Buffer.alloc(CHUNK + overlap)
	const fd = openSync(path, "r")
	try {
		let carried = 0
		for (let n = readSync(fd, buf, 0, CHUNK, null); n > 0; n = readSync(fd, buf, carried, CHUNK, null)) {
			const end = carried + n
			if (containsSecret(buf.toString("latin1", 0, end), needles)) return true
			carried = Math.min(overlap, end)
			buf.copy(buf, 0, end - carried, end)
		}
		return false
	} finally {
		closeSync(fd)
	}
}

/**
 * Answers only whether any needle (`secretNeedles` of the keyed run's own environment) appears in any file of the
 * checkout, ignored ones included, or of the caches, never which one or where. A keyless run has no needles, so it
 * checks only for wallet stores left on disk. `skip` holds the disposable keys' own directory, which holds them by design.
 */
export function scanForSecrets(
	repoRoot: string,
	needles: readonly string[],
	roots = { cache: CACHE_ROOT, wallets: WALLET_TMP_ROOT, skip: [DISPOSABLE_DIR] },
): ScanResult {
	const w: Walk = { files: new Set(), skipped: 0 }
	if (needles.length > 0) for (const root of [repoRoot, roots.cache]) walk(root, roots.skip, w)
	let found = false
	for (const f of w.files) {
		try {
			found = fileContains(f, needles)
		} catch (e) {
			if (code(e) !== "ENOENT") w.skipped++
		}
		if (found) break
	}
	const walletDirs = existsSync(roots.wallets) ? readdirSync(roots.wallets) : []
	return { found, files: w.files.size, skipped: w.skipped, walletDirs }
}
