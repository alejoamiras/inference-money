import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { memoryPaymentStore, type PaymentRecord, type PaymentStore } from "@inference-money/bridge-core"

export const STATE_ROOT = join(homedir(), ".cache", "inference-money")
/** The keyed-run checkout that `scripts/keyed-worktree.sh` maintains. */
export const keyedWorktree = (): string => resolve(process.env.KEYED_WORKTREE ?? join(STATE_ROOT, "keyed"))
/** The disposable fallback's keys, outside every checkout. */
export const DISPOSABLE_DIR = join(STATE_ROOT, "disposable")

const alive = (pid: number) => {
	try {
		process.kill(pid, 0)
		return true
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === "EPERM"
	}
}

const code = (e: unknown) => (e as NodeJS.ErrnoException).code

/** The pid a lock file names, or undefined once it is gone. */
function holderOf(lock: string): number | undefined {
	let text: string
	try {
		text = readFileSync(lock, "utf8")
	} catch (e) {
		if (code(e) === "ENOENT") return undefined
		throw e
	}
	const pid = Number(text)
	if (!Number.isInteger(pid) || pid <= 0) throw new Error(`${lock} names no process; remove it if nothing holds the state`)
	return pid
}

/** Writes `data` to a new owner-only file and flushes it to disk. */
function writeDurably(path: string, data: string): void {
	const fd = openSync(path, "wx", 0o600)
	try {
		writeSync(fd, data)
		fsyncSync(fd)
	} finally {
		closeSync(fd)
	}
}

function syncDir(dir: string): void {
	const fd = openSync(dir, "r")
	try {
		fsyncSync(fd)
	} finally {
		closeSync(fd)
	}
}

/**
 * Moves a lock that names the dead `dead` aside. Between reading the holder and the move, a live process may have taken
 * the lock over: then the moved lock names it, and is put back.
 */
export function takeOverStaleLock(lock: string, dead: number): void {
	const aside = `${lock}.${process.pid}.stale`
	try {
		renameSync(lock, aside)
	} catch (e) {
		if (code(e) === "ENOENT") return
		throw e
	}
	try {
		if (holderOf(aside) !== dead) linkSync(aside, lock)
	} finally {
		rmSync(aside, { force: true })
	}
}

/**
 * A directory of state files that one process at a time may hold. The lock is a file naming its holder's pid, linked
 * into place whole, so it never exists without one; a dead holder's lock is taken over. The files can hold deposit
 * secrets: owner-only, never in a checkout.
 */
export class StateDir {
	private constructor(readonly dir: string) {}

	/** Takes `<STATE_ROOT>/<kind>/<name>`, e.g. one deployment's smoke; throws if a live process holds it. */
	static acquire(kind: string, name: string, root = STATE_ROOT): StateDir {
		const dir = join(root, kind, name)
		mkdirSync(dir, { recursive: true, mode: 0o700 })
		const lock = join(dir, "lock")
		const mine = `${lock}.${process.pid}`
		rmSync(mine, { force: true })
		writeDurably(mine, String(process.pid))
		try {
			for (let attempt = 0; attempt < 3; attempt++) {
				try {
					linkSync(mine, lock)
					return new StateDir(dir)
				} catch (e) {
					if (code(e) !== "EEXIST") throw e
				}
				const holder = holderOf(lock)
				if (holder !== undefined && alive(holder)) throw new Error(`${dir} is in use by process ${holder}`)
				if (holder !== undefined) takeOverStaleLock(lock, holder)
			}
			throw new Error(`could not take the lock on ${dir}`)
		} finally {
			rmSync(mine, { force: true })
		}
	}

	read<T>(file: string): T | undefined {
		const path = join(this.dir, file)
		return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : undefined
	}

	/** Atomic, owner-only and flushed before the rename: a crash or a power loss leaves this version or the last. */
	write(file: string, value: unknown): void {
		const path = join(this.dir, file)
		const tmp = `${path}.${process.pid}.tmp`
		rmSync(tmp, { force: true })
		writeDurably(tmp, `${JSON.stringify(value, null, "\t")}\n`)
		renameSync(tmp, path)
		syncDir(this.dir)
	}

	remove(file: string): void {
		rmSync(join(this.dir, file), { force: true })
	}

	/** Removes the lock only while it is still this process's. */
	release(): void {
		const lock = join(this.dir, "lock")
		if (holderOf(lock) === process.pid) rmSync(lock, { force: true })
	}

	/** Payment records kept in this directory: the lock already makes this process their only writer. */
	paymentStore(file = "payments.json"): PaymentStore {
		const memory = memoryPaymentStore()
		return {
			locked: (key, fn) => memory.locked(key, fn),
			get: async (key) => this.read<Record<string, PaymentRecord>>(file)?.[key],
			put: async (key, record) => {
				const all = { ...(this.read<Record<string, PaymentRecord>>(file) ?? {}) }
				if (record) all[key] = record
				else delete all[key]
				this.write(file, all)
			},
		}
	}
}

export async function withStateDir<T>(kind: string, name: string, fn: (s: StateDir) => Promise<T>, root = STATE_ROOT): Promise<T> {
	const state = StateDir.acquire(kind, name, root)
	try {
		return await fn(state)
	} finally {
		state.release()
	}
}
