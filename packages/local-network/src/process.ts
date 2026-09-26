import { execFileSync, spawn } from "node:child_process"
import { closeSync, openSync } from "node:fs"

/** A process group this run created, identified by its leader's pid AND start time, so a recycled pid is never signalled. */
export interface OwnedProcess {
	name: string
	pgid: number
	started: string
}

export function processStart(pid: number): string | undefined {
	try {
		return execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" }).trim() || undefined
	} catch {
		return undefined
	}
}

function groupAlive(pgid: number): boolean {
	try {
		process.kill(-pgid, 0)
		return true
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === "EPERM"
	}
}

/**
 * "reused" when a different process now leads that pid. A group whose leader exited but whose members live is still
 * ours: the kernel never allocates a pid that still names a live process group.
 */
export function groupState(p: OwnedProcess): "ours" | "gone" | "reused" {
	const start = processStart(p.pgid)
	if (start === undefined) return groupAlive(p.pgid) ? "ours" : "gone"
	return start === p.started ? "ours" : "reused"
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitGone(pgid: number, ms: number): Promise<boolean> {
	for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (!groupAlive(pgid)) return true
	return !groupAlive(pgid)
}

/** SIGTERM to the whole group, SIGKILL after a grace period; never signals a group that is not verifiably ours. */
export async function stopOwnedGroup(p: OwnedProcess, graceMs = 10_000): Promise<"stopped" | "gone" | "reused"> {
	const state = groupState(p)
	if (state !== "ours") return state
	const signal = (sig: NodeJS.Signals) => {
		try {
			process.kill(-p.pgid, sig)
		} catch {}
	}
	signal("SIGTERM")
	if (await waitGone(p.pgid, graceMs)) return "stopped"
	signal("SIGKILL")
	if (await waitGone(p.pgid, 5_000)) return "stopped"
	throw new Error(`${p.name} (pgid ${p.pgid}) survived SIGKILL`)
}

export interface Spawned extends OwnedProcess {
	exitCode: () => number | null | undefined
}

/**
 * Starts `bin` as the leader of a new process group whose output goes straight to `logFile`, so it outlives this
 * process and nothing it writes can block on an unread pipe. `exitCode()` stays undefined while it runs (as observed
 * by this process); callers poll it to fail fast instead of waiting out a health timeout.
 */
export async function spawnDetached(
	name: string,
	bin: string,
	args: string[],
	opts: { env: NodeJS.ProcessEnv; logFile: string },
): Promise<Spawned> {
	const fd = openSync(opts.logFile, "a", 0o600)
	let exit: number | null | undefined
	let failure: Error | undefined
	const child = spawn(bin, args, { detached: true, stdio: ["ignore", fd, fd], env: opts.env })
	closeSync(fd)
	child.once("error", (e) => {
		failure = e
	})
	child.once("exit", (code) => {
		exit = code
	})
	child.unref()
	for (let i = 0; i < 50; i++) {
		const started = child.pid === undefined ? undefined : processStart(child.pid)
		if (started && child.pid !== undefined) return { name, pgid: child.pid, started, exitCode: () => exit }
		if (failure || exit !== undefined) break
		await sleep(20)
	}
	throw new Error(`${name}: could not start ${bin} (${failure?.message ?? `exit ${exit}`}); see ${opts.logFile}`)
}
