import { readFileSync } from "node:fs"
import { createServer } from "node:net"
import { claimPorts, HOST_REGISTRY, PortClaimConflict, registeredPorts } from "./registry"

export interface NetPorts {
	anvil: number
	aztec: number
	aztecAdmin: number
	aztecP2p: number
}

const STATIC_LO = 10_000
const FLOOR_GUARD = 512

/**
 * The OS hands ports at or above this floor to outgoing connections, which can grab one between the bind test and the
 * spawn; below it nothing is handed out unasked.
 */
function ephemeralFloor(): number {
	try {
		const lo = Number.parseInt(readFileSync("/proc/sys/net/ipv4/ip_local_port_range", "utf8").trim().split(/\s+/)[0] ?? "", 10)
		return Number.isFinite(lo) && lo > STATIC_LO + 1024 ? lo : 32_768
	} catch {
		return 32_768
	}
}

/** Holds the port until released; resolves null on any bind failure. */
function tryBind(port: number): Promise<{ release: () => Promise<void> } | null> {
	return new Promise((resolve) => {
		const srv = createServer()
		srv.unref()
		srv.once("error", () => resolve(null))
		srv.listen(port, "127.0.0.1", () => resolve({ release: () => new Promise<void>((r) => srv.close(() => r())) }))
	})
}

async function pickPorts(taken: Set<number>, count: number): Promise<number[]> {
	const hi = ephemeralFloor() - FLOOR_GUARD
	const held: { port: number; release: () => Promise<void> }[] = []
	try {
		for (let tries = 0; held.length < count && tries < 512; tries++) {
			const port = STATIC_LO + Math.floor(Math.random() * (hi - STATIC_LO))
			if (taken.has(port) || held.some((h) => h.port === port)) continue
			const bound = await tryBind(port)
			if (bound) held.push({ port, ...bound })
		}
		if (held.length < count) throw new Error(`no ${count} free loopback ports in [${STATIC_LO}, ${hi})`)
		return held.map((h) => h.port)
	} finally {
		await Promise.all(held.map((h) => h.release()))
	}
}

/**
 * One distinct free port per service, bind-tested together and then claimed in the registry under `label`; a pick
 * another run claimed meanwhile is redrawn.
 */
export async function claimServicePorts<S extends string>(
	c: { runId: string; label: string; services: readonly S[]; pidHint: number; worktree: string },
	registry = HOST_REGISTRY,
): Promise<Record<S, number>> {
	for (let attempt = 0; ; attempt++) {
		const picked = await pickPorts(registeredPorts(registry), c.services.length)
		const ports = Object.fromEntries(c.services.map((s, i) => [s, picked[i] as number])) as Record<S, number>
		try {
			await claimPorts({ runId: c.runId, label: c.label, ports, pidHint: c.pidHint, worktree: c.worktree }, registry)
			return ports
		} catch (e) {
			if (!(e instanceof PortClaimConflict) || attempt >= 4) throw e
		}
	}
}

export function claimNetPorts(runId: string, pidHint: number, worktree: string, registry = HOST_REGISTRY): Promise<NetPorts> {
	const services = ["anvil", "aztec", "aztecAdmin", "aztecP2p"] as const
	return claimServicePorts({ runId, label: "inference-money-net", services, pidHint, worktree }, registry)
}
