import { existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { processStart } from "./process"

/** The host-wide record of who is RUNNING what, where; shared with every other agent's tooling on this machine. */
export const HOST_REGISTRY = join(homedir(), ".agents", "ports.md")

/**
 * The lock the host's other tooling already takes: `<registry>.lock`, created exclusively (theirs may be empty, and they
 * break any lock after 15 s). Ours names its holder. Nothing here ever breaks a lock: two waiters reclaiming the same
 * stale lock could both enter, so a dead holder's lock is reported for removal instead.
 */
const HEADER = [
	"# Ports registry — who is RUNNING what, where (atomic-locked)",
	"",
	"| port | service | owner (run) | worktree | pid-hint | claimed |",
	"|---|---|---|---|---|---|",
]

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const readLock = (lock: string): string | undefined => {
	try {
		return readFileSync(lock, "utf8")
	} catch {
		return undefined
	}
}

/** Dead only when a named pid no longer runs with the start time it wrote; an unnamed holder is never judged. */
function holderDead(owner: string): boolean {
	const [pid, ...start] = owner.split(" ")
	if (!pid || !/^\d+$/.test(pid)) return false
	try {
		return processStart(Number(pid)) !== start.join(" ")
	} catch {
		return false
	}
}

/** `link` publishes the lock with its holder already written, so no one ever sees ours unnamed. */
function tryLock(lock: string, me: string): boolean {
	const tmp = `${lock}.${process.pid}.tmp`
	writeFileSync(tmp, me, { mode: 0o600 })
	try {
		linkSync(tmp, lock)
		return true
	} catch {
		const owner = readLock(lock)
		if (owner !== undefined && holderDead(owner)) {
			throw new Error(`${lock} is held by pid ${owner.split(" ")[0]}, which is no longer running; remove that file and retry`)
		}
		return false
	} finally {
		rmSync(tmp, { force: true })
	}
}

/**
 * Rewrites the registry under its lock, replacing the file whole (a reader or a crash never sees half of it); false
 * when the lock never came free.
 */
async function withRegistry(path: string, mutate: (lines: string[]) => string[]): Promise<boolean> {
	mkdirSync(dirname(path), { recursive: true })
	const lock = `${path}.lock`
	const me = `${process.pid} ${processStart(process.pid) ?? ""}`
	for (let i = 0; i < 100; i++) {
		if (tryLock(lock, me)) {
			try {
				const current = existsSync(path) ? readFileSync(path, "utf8") : `${HEADER.join("\n")}\n`
				const tmp = `${path}.${process.pid}.tmp`
				writeFileSync(tmp, mutate(current.split("\n")).join("\n"))
				renameSync(tmp, path)
			} finally {
				if (readLock(lock) === me) rmSync(lock, { force: true })
			}
			return true
		}
		await sleep(75 + Math.floor(Math.random() * 50))
	}
	return false
}

interface Row {
	port: number
	service: string
	owner: string
	pid: number
}

function parseRow(line: string): Row | undefined {
	const cells = line.split("|").map((c) => c.trim())
	const port = Number.parseInt(cells[1] ?? "", 10)
	if (!Number.isInteger(port) || !/^\d+$/.test(cells[1] ?? "")) return undefined
	return { port, service: cells[2] ?? "", owner: cells[3] ?? "", pid: Number.parseInt(cells[5] ?? "", 10) }
}

function alive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false
	try {
		process.kill(pid, 0)
		return true
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === "EPERM"
	}
}

/** Every port the registry lists, whoever claimed it. */
export function registeredPorts(path = HOST_REGISTRY): Set<number> {
	if (!existsSync(path)) return new Set()
	const rows = readFileSync(path, "utf8").split("\n").map(parseRow)
	return new Set(rows.flatMap((r) => (r ? [r.port] : [])))
}

/** A claim found one of its ports already listed: pick again. */
export class PortClaimConflict extends Error {
	constructor(readonly ports: number[]) {
		super(`ports already claimed: ${ports.join(", ")}`)
		this.name = "PortClaimConflict"
	}
}

export interface Claim {
	runId: string
	/** Prefixes every service name; rows under it whose pid-hint is dead are reaped on the next claim. */
	label: string
	ports: Record<string, number>
	/** A process that lives exactly as long as the ports are in use. */
	pidHint: number
	worktree: string
}

/**
 * Claims one row per service, so every other run picks around these ports from now on, not only once something
 * listens. Check and write happen under one lock. Rows with this claim's label whose pid-hint died are reaped first;
 * rows of any other label are never touched.
 */
export async function claimPorts(c: Claim, path = HOST_REGISTRY): Promise<void> {
	const wanted = new Set(Object.values(c.ports))
	let conflicts: number[] = []
	const stamp = new Date().toISOString()
	const written = await withRegistry(path, (lines) => {
		const kept = lines.filter((l) => {
			const r = parseRow(l)
			return l.trim().length > 0 && !(r?.service.startsWith(`${c.label}-`) && !alive(r.pid))
		})
		conflicts = kept.flatMap((l) => {
			const r = parseRow(l)
			return r && wanted.has(r.port) ? [r.port] : []
		})
		if (conflicts.length > 0) return lines
		const rows = Object.entries(c.ports).map(
			([service, port]) => `| ${port} | ${c.label}-${service} | ${c.runId} | ${c.worktree} | ${c.pidHint} | ${stamp} |`,
		)
		return [...kept, ...rows, ""]
	})
	if (!written) throw new Error(`${path} stayed locked; could not claim ports ${[...wanted].join(", ")} for ${c.runId}`)
	if (conflicts.length > 0) throw new PortClaimConflict(conflicts)
}

/** Re-points `runId`'s rows at the process that now holds its ports: the claiming process may exit before they are released. */
export async function setPidHint(runId: string, pid: number, path = HOST_REGISTRY): Promise<void> {
	const done = await withRegistry(path, (lines) =>
		lines.map((l) => {
			if (parseRow(l)?.owner !== runId) return l
			const cells = l.split("|")
			cells[5] = ` ${pid} `
			return cells.join("|")
		}),
	)
	if (!done) throw new Error(`${path} stayed locked; could not record pid ${pid} for ${runId}`)
}

/** Drops every row `runId` owns. Never throws: a locked registry is reported, and the rows are removable by hand. */
export async function releasePorts(runId: string, path = HOST_REGISTRY): Promise<void> {
	const done = await withRegistry(path, (lines) => lines.filter((l) => parseRow(l)?.owner !== runId))
	if (!done) console.warn(`[net] ${path} stayed locked; remove the rows owned by ${runId} by hand`)
}
