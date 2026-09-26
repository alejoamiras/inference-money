import { randomBytes } from "node:crypto"
import { accessSync, constants, mkdirSync, readFileSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, join } from "node:path"
import {
	L1_CHAIN_ID,
	localDeploymentDir,
	NET_LOG_DIR,
	NET_ROOT,
	type NetHandle,
	REPO_ROOT,
	readHandle,
	removeHandle,
	runDataDir,
	writeHandle,
} from "./handle"
import { claimNetPorts, type NetPorts } from "./ports"
import { groupState, type OwnedProcess, type Spawned, spawnDetached, stopOwnedGroup } from "./process"
import { releasePorts, setPidHint } from "./registry"

/** Anvil's key count; every index a harness or test actor signs from must be below it (index 0 is the node's publisher). */
export const ANVIL_ACCOUNTS = 16

interface Toolchain {
	version: string
	anvil: string
	aztec: string
	internalBin: string
}

/**
 * The node version the testnet runs, from `toolchain.json`. Only a complete install is accepted: `@aztec/ethereum`
 * resolves forge/anvil from `~/.aztec/current` before PATH, so a partial one would deploy L1 with whatever version
 * another agent last pointed that symlink at.
 */
export function resolveToolchain(root = REPO_ROOT): Toolchain {
	const version = (JSON.parse(readFileSync(join(root, "toolchain.json"), "utf8")) as { aztecNode: string }).aztecNode
	const base = join(homedir(), ".aztec", "versions", version)
	const t = {
		version,
		anvil: join(base, "internal-bin", "anvil"),
		aztec: join(base, "node_modules", ".bin", "aztec"),
		internalBin: join(base, "internal-bin"),
	}
	const missing = [t.anvil, t.aztec, join(t.internalBin, "forge")].filter((p) => {
		try {
			accessSync(p, constants.X_OK)
			return false
		} catch {
			return true
		}
	})
	if (missing.length > 0)
		throw new Error(`aztec ${version} toolchain is incomplete (missing ${missing.join(", ")}); run: aztec-up install ${version}`)
	return t
}

async function rpcResponds(url: string, method: string): Promise<boolean> {
	try {
		const res = await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
			signal: AbortSignal.timeout(5_000),
		})
		return res.ok && ((await res.json()) as { result?: unknown }).result != null
	} catch {
		return false
	}
}

async function waitHealthy(p: Spawned, url: string, method: string, timeoutMs: number, logFile: string): Promise<void> {
	for (const end = Date.now() + timeoutMs; Date.now() < end; await new Promise((r) => setTimeout(r, 500))) {
		if (p.exitCode() !== undefined) throw new Error(`${p.name} exited (code ${p.exitCode()}) before answering; see ${logFile}`)
		if (await rpcResponds(url, method)) return
	}
	throw new Error(`${p.name} did not answer ${method} at ${url} within ${timeoutMs / 1000}s; see ${logFile}`)
}

function nodeEnv(t: Toolchain, anvilUrl: string, tmpDir: string): NodeJS.ProcessEnv {
	// Either switch would override the key hash below, so the child never inherits them.
	const { AZTEC_DISABLE_ADMIN_API_KEY: _d, AZTEC_RESET_ADMIN_API_KEY: _r, ...inherited } = process.env
	return {
		...inherited,
		PATH: `${t.internalBin}${delimiter}${process.env.PATH ?? ""}`,
		// The node's L1 deploy leaks a large scratch dir per boot; confined here, teardown reclaims it.
		TMPDIR: tmpDir,
		// One tx makes a block. It does not make the chain tick on its own: see withBlockHeartbeat.
		SEQ_MIN_TX_PER_BLOCK: "0",
		ETHEREUM_HOSTS: anvilUrl,
		// `aztec start` binds every interface: the admin API stays authenticated behind a hash no key matches.
		AZTEC_ADMIN_API_KEY_HASH: randomBytes(32).toString("hex"),
		FORGE_BIN: join(t.internalBin, "forge"),
		ANVIL_BIN: t.anvil,
	}
}

async function boot(t: Toolchain, runId: string, ports: NetPorts, dataDir: string, spawned: Spawned[]): Promise<void> {
	const anvilUrl = `http://127.0.0.1:${ports.anvil}`
	const logs = { anvil: join(NET_LOG_DIR, `${runId}-anvil.log`), aztec: join(NET_LOG_DIR, `${runId}-aztec.log`) }
	const anvilArgs = ["--host", "127.0.0.1", "--port", String(ports.anvil), "--chain-id", String(L1_CHAIN_ID)]
	anvilArgs.push("--slots-in-an-epoch", "1", "--accounts", String(ANVIL_ACCOUNTS), "--silent")
	const anvil = await spawnDetached("anvil", t.anvil, anvilArgs, { env: process.env, logFile: logs.anvil })
	spawned.push(anvil)
	await waitHealthy(anvil, anvilUrl, "eth_chainId", 60_000, logs.anvil)
	const nodeArgs = ["start", "--local-network", "--port", String(ports.aztec), "--admin-port", String(ports.aztecAdmin)]
	nodeArgs.push("--p2p.p2pPort", String(ports.aztecP2p), "--l1-rpc-urls", anvilUrl, "--data-directory", join(dataDir, "node"))
	const tmpDir = join(dataDir, "tmp")
	mkdirSync(tmpDir, { recursive: true, mode: 0o700 })
	const node = await spawnDetached("aztec", t.aztec, nodeArgs, { env: nodeEnv(t, anvilUrl, tmpDir), logFile: logs.aztec })
	spawned.push(node)
	await waitHealthy(node, `http://127.0.0.1:${ports.aztec}`, "node_getNodeInfo", 300_000, logs.aztec)
}

const owned = (s: Spawned): OwnedProcess => ({ name: s.name, pgid: s.pgid, started: s.started })

/**
 * Boots anvil + `aztec start --local-network` for `runId` and returns once both answer. Both run detached and outlive
 * this process; `netDown` is the only teardown. A failed boot tears down whatever it started.
 */
export async function netUp(runId: string, log: (m: string) => void = console.log): Promise<NetHandle> {
	const existing = readHandle(runId)
	if (existing?.processes.some((p) => groupState(p) === "ours")) throw new Error(`run ${runId} is already up; net:down first`)
	if (existing) await netDown(runId, log)
	const t = resolveToolchain()
	const dataDir = runDataDir(runId)
	mkdirSync(dataDir, { recursive: true, mode: 0o700 })
	mkdirSync(NET_LOG_DIR, { recursive: true, mode: 0o700 })
	const ports = await claimNetPorts(runId, process.pid, REPO_ROOT)
	const spawned: Spawned[] = []
	try {
		log(`[net] ${runId}: anvil :${ports.anvil}, aztec ${t.version} :${ports.aztec}, data ${dataDir}`)
		await boot(t, runId, ports, dataDir, spawned)
		const handle: NetHandle = {
			runId,
			anvilUrl: `http://127.0.0.1:${ports.anvil}`,
			nodeUrl: `http://127.0.0.1:${ports.aztec}`,
			l1ChainId: L1_CHAIN_ID,
			ports,
			dataDir,
			processes: spawned.map(owned),
			worktree: REPO_ROOT,
			nodeVersion: t.version,
			createdAt: new Date().toISOString(),
		}
		writeHandle(handle)
		await setPidHint(runId, spawned[0]!.pgid)
		return handle
	} catch (e) {
		for (const p of spawned.reverse()) await stopOwnedGroup(p).catch(() => {})
		await releasePorts(runId)
		rmSync(dataDir, { recursive: true, force: true })
		throw e
	}
}

/** Stops only the process groups this run's handle proves it owns, then releases its ports and removes its state. */
export async function netDown(runId: string, log: (m: string) => void = console.log): Promise<void> {
	const h = readHandle(runId)
	for (const p of [...(h?.processes ?? [])].reverse()) log(`[net] ${runId}: ${p.name} (pgid ${p.pgid}) ${await stopOwnedGroup(p)}`)
	await releasePorts(runId)
	rmSync(runDataDir(runId), { recursive: true, force: true })
	rmSync(localDeploymentDir(runId), { recursive: true, force: true })
	removeHandle(runId)
	if (!h) log(`[net] ${runId}: no handle; released any registry rows and state`)
}

export interface NetStatus {
	handle: NetHandle | undefined
	processes: { name: string; pgid: number; state: string }[]
	anvil: boolean
	node: boolean
}

export async function netStatus(runId: string): Promise<NetStatus> {
	const handle = readHandle(runId)
	if (!handle) return { handle, processes: [], anvil: false, node: false }
	return {
		handle,
		processes: handle.processes.map((p) => ({ name: p.name, pgid: p.pgid, state: groupState(p) })),
		anvil: await rpcResponds(handle.anvilUrl, "eth_chainId"),
		node: await rpcResponds(handle.nodeUrl, "node_getNodeInfo"),
	}
}

export { NET_ROOT }
