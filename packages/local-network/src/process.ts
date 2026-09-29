import { execFileSync, spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { closeSync, existsSync, openSync, readFileSync } from "node:fs"

/** Set in every spawned group's env; never a secret. */
export const OWNER_MARKER = "INFERENCE_MONEY_OWNER"

/**
 * A process group this run created: its leader's pid AND start time identify it while the leader lives, and the
 * `marker` its members inherit (as {@link OWNER_MARKER}) once only they remain.
 */
export interface OwnedProcess {
	name: string
	pgid: number
	started: string
	marker: string
}

/** The pid's start time, or undefined when no process has it; any other `ps` failure throws. */
export function processStart(pid: number): string | undefined {
	try {
		const out = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
		return out.trim() || undefined
	} catch (e) {
		const x = e as { status?: number; stdout?: string }
		if (x.status === 1 && !x.stdout?.trim()) return undefined
		throw e
	}
}

/**
 * A leaderless group's owner, read from its members' environments: ours on our marker, "reused" only on another
 * run's marker. A member can clear its env or hide it, so no marker at all proves nothing. Linux `/proc` only.
 */
function markerEvidence(pgid: number, marker: string): GroupState {
	if (!existsSync("/proc/self/environ")) return "unverified"
	let other = false
	for (const line of execFileSync("ps", ["-eo", "pid=,pgid="], { encoding: "utf8" }).trim().split("\n")) {
		const [pid, group] = line.trim().split(/\s+/).map(Number)
		if (group !== pgid) continue
		try {
			const env = `\0${readFileSync(`/proc/${pid}/environ`, "latin1")}\0`
			if (env.includes(`\0${OWNER_MARKER}=${marker}\0`)) return "ours"
			other ||= env.includes(`\0${OWNER_MARKER}=`)
		} catch {}
	}
	return other ? "reused" : "unverified"
}

function groupAlive(pgid: number): boolean {
	try {
		process.kill(-pgid, 0)
		return true
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === "EPERM"
	}
}

export type GroupState = "ours" | "gone" | "reused" | "unverified"

/**
 * "ours" only on proof: the leader's start time, or, once the leader exited, a member carrying the marker (the pgid may
 * have been reused by a group whose own leader then exited). Anything unprovable is never signalled.
 */
export function groupState(p: OwnedProcess): GroupState {
	try {
		const start = processStart(p.pgid)
		if (start !== undefined) return start === p.started ? "ours" : "reused"
		if (!groupAlive(p.pgid)) return "gone"
		return markerEvidence(p.pgid, p.marker)
	} catch {
		return "unverified"
	}
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitGone(pgid: number, ms: number): Promise<boolean> {
	for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (!groupAlive(pgid)) return true
	return !groupAlive(pgid)
}

/** SIGTERM to the whole group, SIGKILL after a grace period; never signals a group that is not verifiably ours. */
export async function stopOwnedGroup(p: OwnedProcess, graceMs = 10_000): Promise<"stopped" | GroupState> {
	const state = groupState(p)
	if (state !== "ours") return state
	const signal = (sig: NodeJS.Signals) => {
		try {
			process.kill(-p.pgid, sig)
		} catch {}
	}
	signal("SIGTERM")
	if (await waitGone(p.pgid, graceMs)) return "stopped"
	// The group may have ended and its pgid been reused during the grace period.
	const again = groupState(p)
	if (again !== "ours") return again === "gone" ? "stopped" : again
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
	const marker = `${name}-${randomUUID()}`
	const child = spawn(bin, args, { detached: true, stdio: ["ignore", fd, fd], env: { ...opts.env, [OWNER_MARKER]: marker } })
	closeSync(fd)
	child.once("error", (e) => {
		failure = e
	})
	child.once("exit", (code) => {
		exit = code
	})
	child.unref()
	try {
		for (let i = 0; i < 50; i++) {
			const started = child.pid === undefined ? undefined : processStart(child.pid)
			if (started && child.pid !== undefined) return { name, pgid: child.pid, started, marker, exitCode: () => exit }
			if (failure || exit !== undefined) break
			await sleep(20)
		}
	} catch (e) {
		failure = e as Error
	}
	// No handle will ever record this group, so it must not outlive the failure.
	try {
		if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL")
	} catch {}
	throw new Error(`${name}: could not start ${bin} (${failure?.message ?? `exit ${exit}`}); see ${opts.logFile}`)
}
