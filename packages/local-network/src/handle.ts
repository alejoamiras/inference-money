import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { z } from "zod"

export const REPO_ROOT = resolve(import.meta.dirname, "../../..")
/** Real disk, never tmpfs: a store killed before teardown would otherwise pin its RAM until the holder dies. */
export const NET_ROOT = join(homedir(), ".cache", "inference-money", "net")
/** Outside each run's data dir, which teardown removes, so a failed run's logs survive it. */
export const NET_LOG_DIR = join(NET_ROOT, "logs")
export const L1_CHAIN_ID = 31337
/** What a deploy to this run's network wrote; teardown removes it, since it names contracts on a chain that is gone. */
export const localDeploymentDir = (runId: string) => join(REPO_ROOT, "deployments", "local", runId)

const RUN_TAG = /^[a-z0-9][a-z0-9-]{0,31}$/

/**
 * The run id: `RUN_ID` (default "default") namespaced by this checkout, so the same tag in two worktrees never
 * shares ports, state or processes, while every command in one checkout agrees on it.
 */
export function runIdFor(env: NodeJS.ProcessEnv = process.env, root = REPO_ROOT): string {
	const tag = env.RUN_ID ?? "default"
	if (!RUN_TAG.test(tag)) throw new Error(`RUN_ID "${tag}" must match ${RUN_TAG}`)
	return `${createHash("sha256").update(root).digest("hex").slice(0, 8)}-${tag}`
}

const processSchema = z.strictObject({
	name: z.string(),
	pgid: z.number().int().positive(),
	started: z.string().min(1),
	marker: z.string().min(1),
})

export const netHandleSchema = z.strictObject({
	runId: z.string(),
	anvilUrl: z.url(),
	nodeUrl: z.url(),
	l1ChainId: z.literal(L1_CHAIN_ID),
	ports: z.strictObject({
		anvil: z.number().int(),
		aztec: z.number().int(),
		aztecAdmin: z.number().int(),
		aztecP2p: z.number().int(),
	}),
	dataDir: z.string(),
	/** Rewritten as each process spawns, so an interrupted boot still leaves `netDown` everything to stop. */
	processes: z.array(processSchema),
	/** Both services answered; until then the handle serves teardown only. */
	ready: z.boolean(),
	worktree: z.string(),
	nodeVersion: z.string(),
	createdAt: z.string(),
})

export type NetHandle = z.infer<typeof netHandleSchema>

export const handlePath = (runId: string, root = NET_ROOT) => join(root, `${runId}.json`)
export const runDataDir = (runId: string, root = NET_ROOT) => join(root, runId)

export function readHandle(runId: string, root = NET_ROOT): NetHandle | undefined {
	const path = handlePath(runId, root)
	if (!existsSync(path)) return undefined
	return netHandleSchema.parse(JSON.parse(readFileSync(path, "utf8")))
}

/** Written atomically, owner-only: a reader never sees half a handle. */
export function writeHandle(h: NetHandle, root = NET_ROOT): void {
	const path = handlePath(h.runId, root)
	mkdirSync(dirname(path), { recursive: true })
	const tmp = `${path}.${process.pid}.tmp`
	writeFileSync(tmp, `${JSON.stringify(netHandleSchema.parse(h), null, "\t")}\n`, { mode: 0o600 })
	renameSync(tmp, path)
}

export function removeHandle(runId: string, root = NET_ROOT): void {
	rmSync(handlePath(runId, root), { force: true })
}

export interface NetEndpoints {
	anvilUrl: string
	nodeUrl: string
	attached: boolean
}

/**
 * The network a command acts on: `NET_L1_RPC` + `NET_NODE_URL` together attach to one already running (never torn
 * down here); otherwise this run's handle. One variable alone is refused rather than guessed.
 */
export function resolveEndpoints(runId: string, env: NodeJS.ProcessEnv = process.env, root = NET_ROOT): NetEndpoints {
	const { NET_L1_RPC: anvilUrl, NET_NODE_URL: nodeUrl } = env
	if (anvilUrl && nodeUrl) return { anvilUrl, nodeUrl, attached: true }
	if (anvilUrl || nodeUrl) throw new Error("NET_L1_RPC and NET_NODE_URL must be set together")
	const h = readHandle(runId, root)
	if (!h) throw new Error(`no local network for run ${runId}; run net:up first (or set NET_L1_RPC + NET_NODE_URL)`)
	if (!h.ready) throw new Error(`the local network for run ${runId} is still booting or never finished; net:down it if stale`)
	return { anvilUrl: h.anvilUrl, nodeUrl: h.nodeUrl, attached: false }
}
