import { chmodSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export const WALLET_TMP_ROOT = join(homedir(), ".cache", "inference-money", "wallet-tmp")

let active = false

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === "EPERM"
	}
}

/** Removes `<root>/<pid>` directories whose process is gone; returns their names. */
export function reapDead(root: string): string[] {
	const reaped: string[] = []
	for (const name of readdirSync(root)) {
		const pid = Number(name)
		if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid || alive(pid)) continue
		rmSync(join(root, name), { recursive: true, force: true })
		reaped.push(name)
	}
	return reaped
}

/**
 * Runs `fn` with TMPDIR at an owner-only `<root>/<pid>`, removed afterwards. Aztec's "ephemeral" embedded wallet and
 * PXE stores are LMDB files under `os.tmpdir()` holding account secret keys, deleted only on a clean close; this keeps
 * them out of the shared tmp dir, and each run first reaps the directories of runs that died before cleaning up.
 * TMPDIR is process-global and the dir is per-pid, so one scope at a time per process: an overlapping call throws
 * before touching the active one's dir or TMPDIR.
 */
export async function withOwnedTmpDir<T>(fn: () => Promise<T>, root = WALLET_TMP_ROOT): Promise<T> {
	const exit = enterOwnedTmpDir(root)
	try {
		return await fn()
	} finally {
		exit()
	}
}

/**
 * {@link withOwnedTmpDir} for a lifetime no single callback spans (a test suite's setup and teardown hooks). The
 * returned exit restores TMPDIR, frees the scope, then removes the dir; call it exactly once.
 */
export function enterOwnedTmpDir(root = WALLET_TMP_ROOT): () => void {
	if (active) throw new Error("withOwnedTmpDir: a scope is already active in this process; run wallets inside it")
	active = true
	const dir = join(root, String(process.pid))
	const previous = process.env.TMPDIR
	const exit = () => {
		if (previous === undefined) delete process.env.TMPDIR
		else process.env.TMPDIR = previous
		active = false
		rmSync(dir, { recursive: true, force: true })
	}
	try {
		mkdirSync(root, { recursive: true, mode: 0o700 })
		chmodSync(root, 0o700)
		reapDead(root)
		rmSync(dir, { recursive: true, force: true })
		mkdirSync(dir, { mode: 0o700 })
		process.env.TMPDIR = dir
	} catch (e) {
		exit()
		throw e
	}
	return exit
}
