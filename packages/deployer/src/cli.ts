import { REPO_ROOT, runIdFor } from "@inference-money/local-network"
import { deployLocal, verifyLocal } from "./local"
import { networkByName, TESTNET } from "./networks"
import { probeNetwork } from "./preflight"
import { scanForSecrets } from "./scan"
import { loadTestnetSecrets } from "./secrets"
import { smokeTestnet } from "./smoke"
import { proofCompatSpike } from "./spike"
import { deployTestnet, TESTNET_MANIFEST, verifyTestnet } from "./testnet"

const USAGE =
	"usage: bun src/cli.ts <probe|spike|deploy|verify|smoke> testnet | <deploy|verify> local | scan secrets   (RUN_ID selects the local run)"
const log = (m: string) => console.log(m)

async function probe(): Promise<number> {
	const pins = networkByName("testnet")
	const checks = await probeNetwork(pins, process.env.SEPOLIA_RPC_URL || pins.defaultL1RpcUrl)
	for (const c of checks) console.log(`${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail}`)
	const failed = checks.filter((c) => !c.ok).length
	console.log(failed === 0 ? `probe ${pins.name}: all ${checks.length} checks passed` : `probe ${pins.name}: ${failed} failed`)
	return failed === 0 ? 0 : 1
}

async function spike(): Promise<number> {
	const secrets = loadTestnetSecrets(REPO_ROOT)
	const r = await proofCompatSpike(TESTNET, secrets, secrets.sepoliaRpcUrl ?? TESTNET.defaultL1RpcUrl, log)
	console.log(
		`spike testnet: account ${r.account} deployed in tx ${r.txHash} (block ${r.blockNumber}, fee ${r.transactionFee}) after ${r.minutes}m`,
	)
	return 0
}

/** Prints only a yes/no and counts: which secret matched, or where, is never output. */
function scanSecrets(): number {
	const r = scanForSecrets(REPO_ROOT, loadTestnetSecrets(REPO_ROOT))
	console.log(`secrets:scan found=${r.found} files=${r.files} walletDirs=${r.walletDirs.length}`)
	return r.found || r.walletDirs.length > 0 ? 1 : 0
}

const COMMANDS: Record<string, () => Promise<number> | number> = {
	"probe testnet": probe,
	"spike testnet": spike,
	"deploy testnet": async () => {
		const m = await deployTestnet(log)
		console.log(`deploy testnet: verified; manifest ${TESTNET_MANIFEST} (bridge ${m.l2.bridge.address})`)
		console.log("reminder: the L2 owner key (pause/unpause) is TESTNET_AZTEC_SECRET_KEY in .env.testnet; keep it.")
		return 0
	},
	"verify testnet": async () => {
		await verifyTestnet(log)
		console.log("verify testnet: every check passed")
		return 0
	},
	"smoke testnet": async () => {
		await smokeTestnet(log)
		console.log("smoke testnet: all four legs settled")
		return 0
	},
	"deploy local": async () => {
		const { path } = await deployLocal(runIdFor(), log)
		console.log(`deploy local: verified; manifest ${path}`)
		return 0
	},
	"verify local": async () => {
		await verifyLocal(runIdFor(), log)
		console.log("verify local: every check passed")
		return 0
	},
	"scan secrets": scanSecrets,
}

const run = COMMANDS[process.argv.slice(2, 4).join(" ")]
if (!run) console.error(USAGE)
process.exit(run ? await run() : 2)
