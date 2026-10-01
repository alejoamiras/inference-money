import { closeSync, existsSync, openSync, readdirSync, readSync, realpathSync, type Stats, statSync } from "node:fs"
import { homedir } from "node:os"
import { join, sep } from "node:path"
import { WALLET_TMP_ROOT } from "./owned-tmp"
import { DISPOSABLE_DIR } from "./run-state"
import { containsSecret } from "./secrets"

/** Every run's caches (logs, smoke state, forge output, the keyed worktree) live here; wallet stores only transiently. */
const CACHE_ROOT = join(homedir(), ".cache", "inference-money")
/** Installed dependencies are third-party and installed keylessly before any run. */
const DEPENDENCIES = "node_modules"
const CHUNK = 8 * 1024 * 1024

export interface ScanResult {
	found: boolean
	files: number
	/** Paths the scan could not read, or links out of its roots; any fails it, since a leak could hide there. */
	skipped: number
	/** Wallet/PXE store dirs still on disk; any is a teardown leak. */
	walletDirs: string[]
}

export const scanFailed = (r: ScanResult): boolean => r.found || r.skipped > 0 || r.walletDirs.length > 0
export const scanLine = (r: ScanResult): string =>
	`found=${r.found} files=${r.files} skipped=${r.skipped} walletDirs=${r.walletDirs.length}`

const code = (e: unknown) => (e as NodeJS.ErrnoException).code
const inside = (path: string, dir: string) => path === dir || path.startsWith(`${dir}${sep}`)
const realOrSelf = (path: string) => (existsSync(path) ? realpathSync(path) : path)

/** Everything is tracked by real path, so a link is read once and a link cycle ends. */
interface Walk {
	roots: string[]
	skip: string[]
	files: Set<string>
	dirs: Set<string>
	skipped: number
}

function visit(path: string, w: Walk): void {
	let real: string
	let st: Stats
	try {
		real = realpathSync(path)
		st = statSync(real)
	} catch (e) {
		if (code(e) !== "ENOENT") w.skipped++
		return
	}
	if (real.split(sep).includes(DEPENDENCIES) || w.skip.some((s) => inside(real, s))) return
	if (!w.roots.some((r) => inside(real, r))) {
		w.skipped++
		return
	}
	if (st.isFile()) w.files.add(real)
	if (!st.isDirectory() || w.dirs.has(real)) return
	w.dirs.add(real)
	let names: string[]
	try {
		names = readdirSync(real)
	} catch (e) {
		if (code(e) !== "ENOENT") w.skipped++
		return
	}
	for (const name of names) visit(join(real, name), w)
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
 * checkout, ignored ones and `.git` included, or of the caches, never which one or where. A keyless run has no needles,
 * so it checks only for wallet stores left on disk. `skip` holds the disposable keys' own directory, which holds them
 * by design.
 */
export function scanForSecrets(
	repoRoot: string,
	needles: readonly string[],
	roots = { cache: CACHE_ROOT, wallets: WALLET_TMP_ROOT, skip: [DISPOSABLE_DIR] },
): ScanResult {
	const tops = [repoRoot, roots.cache].filter((p) => existsSync(p)).map((p) => realpathSync(p))
	const w: Walk = { roots: tops, skip: roots.skip.map(realOrSelf), files: new Set(), dirs: new Set(), skipped: 0 }
	if (needles.length > 0) for (const top of tops) visit(top, w)
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
