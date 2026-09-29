/**
 * The browser run's loopback ports (the app preview, one wallet origin per profile, the sidecar), claimed in the host
 * registry under the run's id so every other run on the host picks around them.
 *
 *   RUN_ID=<tag> bun e2e/run/resolve-ports.ts claim <state-dir> <owner-pid>   → <state-dir>/ports.json
 *   bun e2e/run/resolve-ports.ts release <resolved run id>
 *
 * ports.json also records the resolved run id (the tag namespaced by this checkout), which every later step keys on.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { claimServicePorts, REPO_ROOT, releasePorts, runIdFor } from "@inference-money/local-network"

const SERVICES = ["web", "walletMain", "walletSolo", "walletLate", "sidecar"] as const

async function main([command, ...args]: string[]): Promise<void> {
	if (command === "release" && args[0]) return releasePorts(args[0])
	const [stateDir, pid] = args
	if (command !== "claim" || !stateDir || !pid) throw new Error("usage: resolve-ports.ts claim <state-dir> <pid> | release <run-id>")
	const runId = runIdFor()
	const ports = await claimServicePorts({
		runId,
		label: "inference-money-web-e2e",
		services: SERVICES,
		pidHint: Number(pid),
		worktree: REPO_ROOT,
	})
	mkdirSync(stateDir, { recursive: true })
	writeFileSync(join(stateDir, "ports.json"), `${JSON.stringify({ runId, ...ports }, null, 2)}\n`)
	console.log(`[e2e] ${runId}: ${JSON.stringify(ports)}`)
}

await main(process.argv.slice(2))
