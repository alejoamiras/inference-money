import { runIdFor } from "./handle"
import { netDown, netStatus, netUp } from "./network"

const USAGE = 'usage: bun src/cli.ts <up|down|status>   (RUN_ID selects the run; default "default")'

async function main(command: string | undefined): Promise<number> {
	const runId = runIdFor()
	switch (command) {
		case "up": {
			const h = await netUp(runId)
			console.log(`[net] ${runId} up: L1 ${h.anvilUrl}, node ${h.nodeUrl}`)
			return 0
		}
		case "down":
			await netDown(runId)
			return 0
		case "status": {
			const s = await netStatus(runId)
			if (!s.handle) {
				console.log(`[net] ${runId}: not up`)
				return 1
			}
			for (const p of s.processes) console.log(`[net] ${runId}: ${p.name} pgid ${p.pgid} ${p.state}`)
			console.log(`[net] ${runId}: anvil ${s.anvil ? "answers" : "silent"}, node ${s.node ? "answers" : "silent"}`)
			return s.anvil && s.node ? 0 : 1
		}
		default:
			console.error(USAGE)
			return 2
	}
}

process.exit(await main(process.argv[2]))
