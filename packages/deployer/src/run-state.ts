import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { memoryPaymentStore, type PaymentRecord, type PaymentStore } from "@inference-money/bridge-core"

export const STATE_ROOT = join(homedir(), ".cache", "inference-money")
/** The keyed-run checkout that `scripts/keyed-worktree.sh` maintains. */
export const keyedWorktree = (): string => resolve(process.env.KEYED_WORKTREE ?? join(STATE_ROOT, "keyed"))
/** The P9 fallback's keys, outside every checkout. */
export const DISPOSABLE_DIR = join(STATE_ROOT, "disposable")

const alive = (pid: number) => {
	try {
		process.kill(pid, 0)
		return true
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === "EPERM"
	}
}

/**
 * A directory of state files that one process at a time may hold (an atomic mkdir lock naming its pid; a dead holder's
 * lock is taken over). The files can hold deposit secrets: owner-only, never in a checkout.
 */
export class StateDir {
	private constructor(readonly dir: string) {}

	/** Takes `<STATE_ROOT>/<kind>/<name>`, e.g. one deployment's smoke; throws if a live process holds it. */
	static acquire(kind: string, name: string, root = STATE_ROOT): StateDir {
		const dir = join(root, kind, name)
		mkdirSync(dir, { recursive: true, mode: 0o700 })
		const lock = join(dir, "lock")
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				mkdirSync(lock)
				writeFileSync(join(lock, "pid"), String(process.pid))
				return new StateDir(dir)
			} catch (e) {
				if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e
				const holder = Number(existsSync(join(lock, "pid")) ? readFileSync(join(lock, "pid"), "utf8") : "0")
				if (holder > 0 && alive(holder)) throw new Error(`${dir} is in use by process ${holder}`)
				rmSync(lock, { recursive: true, force: true })
			}
		}
		throw new Error(`could not take the lock on ${dir}`)
	}

	read<T>(file: string): T | undefined {
		const path = join(this.dir, file)
		return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : undefined
	}

	/** Atomic and owner-only: a crash leaves the previous version, never half of one. */
	write(file: string, value: unknown): void {
		const path = join(this.dir, file)
		const tmp = `${path}.${process.pid}.tmp`
		writeFileSync(tmp, `${JSON.stringify(value, null, "\t")}\n`, { mode: 0o600 })
		renameSync(tmp, path)
	}

	remove(file: string): void {
		rmSync(join(this.dir, file), { force: true })
	}

	release(): void {
		rmSync(join(this.dir, "lock"), { recursive: true, force: true })
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

/** Runs `fn` holding the state dir, releasing it however `fn` ends. */
export async function withStateDir<T>(kind: string, name: string, fn: (s: StateDir) => Promise<T>, root = STATE_ROOT): Promise<T> {
	const state = StateDir.acquire(kind, name, root)
	try {
		return await fn(state)
	} finally {
		state.release()
	}
}
