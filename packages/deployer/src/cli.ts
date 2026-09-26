import { resolve } from "node:path"
import { runIdFor } from "@inference-money/local-network"
import { deployLocal, verifyLocal } from "./local"
import { networkByName } from "./networks"
import { probeNetwork } from "./preflight"
import { loadTestnetSecrets } from "./secrets"
import { proofCompatSpike } from "./spike"

const REPO_ROOT = resolve(import.meta.dir, "../../..")

const USAGE = "usage: bun src/cli.ts <probe|spike> testnet | <deploy|verify> local   (RUN_ID selects the local run)"
const log = (m: string) => console.log(m)

async function probe(networkName: string): Promise<number> {
	const pins = networkByName(networkName)
	const checks = await probeNetwork(pins, process.env.SEPOLIA_RPC_URL || pins.defaultL1RpcUrl)
	for (const c of checks) console.log(`${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail}`)
	const failed = checks.filter((c) => !c.ok).length
	console.log(failed === 0 ? `probe ${pins.name}: all ${checks.length} checks passed` : `probe ${pins.name}: ${failed} failed`)
	return failed === 0 ? 0 : 1
}

async function spike(networkName: string): Promise<number> {
	const pins = networkByName(networkName)
	const secrets = loadTestnetSecrets(REPO_ROOT)
	const r = await proofCompatSpike(pins, secrets, secrets.sepoliaRpcUrl ?? pins.defaultL1RpcUrl, log)
	console.log(
		`spike ${pins.name}: account ${r.account} deployed in tx ${r.txHash} (block ${r.blockNumber}, fee ${r.transactionFee}) after ${r.minutes}m`,
	)
	return 0
}

async function main([command, target]: string[]): Promise<number> {
	if (command === "probe" && target) return probe(target)
	if (command === "spike" && target) return spike(target)
	if (command === "deploy" && target === "local") {
		const { path } = await deployLocal(runIdFor(), log)
		console.log(`deploy local: verified; manifest ${path}`)
		return 0
	}
	if (command === "verify" && target === "local") {
		await verifyLocal(runIdFor(), log)
		console.log("verify local: every check passed")
		return 0
	}
	console.error(USAGE)
	return 2
}

process.exit(await main(process.argv.slice(2)))
