import { chmodSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export const WALLET_TMP_ROOT = join(homedir(), ".cache", "inference-money", "wallet-tmp")

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
 */
export async function withOwnedTmpDir<T>(fn: () => Promise<T>, root = WALLET_TMP_ROOT): Promise<T> {
	mkdirSync(root, { recursive: true, mode: 0o700 })
	chmodSync(root, 0o700)
	reapDead(root)
	const dir = join(root, String(process.pid))
	rmSync(dir, { recursive: true, force: true })
	mkdirSync(dir, { mode: 0o700 })
	const previous = process.env.TMPDIR
	process.env.TMPDIR = dir
	try {
		return await fn()
	} finally {
		if (previous === undefined) delete process.env.TMPDIR
		else process.env.TMPDIR = previous
		rmSync(dir, { recursive: true, force: true })
	}
}
