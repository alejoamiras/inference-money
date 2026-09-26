import { resolve } from "node:path"
import { networkByName } from "./networks"
import { probeNetwork } from "./preflight"
import { loadTestnetSecrets } from "./secrets"
import { proofCompatSpike } from "./spike"

const REPO_ROOT = resolve(import.meta.dir, "../../..")

const USAGE = "usage: bun src/cli.ts <probe|spike> <network>"

async function main(argv: string[]): Promise<number> {
	const [command, networkName] = argv
	if (!command || !networkName) {
		console.error(USAGE)
		return 2
	}
	const pins = networkByName(networkName)
	switch (command) {
		case "probe": {
			const checks = await probeNetwork(pins, process.env.SEPOLIA_RPC_URL || pins.defaultL1RpcUrl)
			for (const c of checks) console.log(`${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail}`)
			const failed = checks.filter((c) => !c.ok).length
			console.log(failed === 0 ? `probe ${pins.name}: all ${checks.length} checks passed` : `probe ${pins.name}: ${failed} failed`)
			return failed === 0 ? 0 : 1
		}
		case "spike": {
			const secrets = loadTestnetSecrets(REPO_ROOT)
			const l1RpcUrl = secrets.sepoliaRpcUrl ?? pins.defaultL1RpcUrl
			const r = await proofCompatSpike(pins, secrets, l1RpcUrl, (m) => console.log(m))
			console.log(
				`spike ${pins.name}: account ${r.account} deployed in tx ${r.txHash} (block ${r.blockNumber}, fee ${r.transactionFee}) after ${r.minutes}m`,
			)
			return 0
		}
		default:
			console.error(USAGE)
			return 2
	}
}

process.exit(await main(process.argv.slice(2)))
