import { rmSync } from "node:fs"
import type { AztecAddress } from "@aztec-labs/aztec.js/addresses"
import { Fr } from "@aztec-labs/aztec.js/fields"
import { type AztecNode, createAztecNodeClient } from "@aztec-labs/aztec.js/node"
import type { EmbeddedWallet } from "@aztec-labs/wallets/embedded"
import {
	type BridgeManifest,
	type OutboxReader,
	outboxReader,
	registerBridgeContracts,
	registerSponsor,
} from "@inference-money/bridge-core"
import {
	deployLocal,
	enterOwnedTmpDir,
	forgeRunDir,
	LOCAL_DEPLOYER_SECRET,
	l1Chain,
	newSponsoredAccount,
	openBridgeWallet,
	recordingNode,
	type SentTx,
	signingKeyFor,
	startBlockHeartbeat,
} from "@inference-money/deployer"
import { L1_CHAIN_ID, localDeploymentDir, netDown, netUp, resolveEndpoints, runIdFor } from "@inference-money/local-network"
import { type Chain, createPublicClient, createTestClient, http, type PublicClient, type TestClient } from "viem"

export const INTEGRATION = Boolean(process.env.INTEGRATION)

export interface Harness {
	manifest: BridgeManifest
	node: AztecNode
	/** Holds every actor account; each tx it submits lands in `sent`. */
	wallet: EmbeddedWallet
	sent: SentTx[]
	/** The bridge's L2 owner (the deploy account), registered in `wallet`. */
	owner: AztecAddress
	outbox: OutboxReader
	l1: { rpcUrl: string; chain: Chain; publicClient: PublicClient; test: TestClient }
}

let current: Harness | undefined
const cleanup: (() => unknown)[] = []

export function harness(): Harness {
	if (!current) throw new Error("The integration harness is not open: run the suite through `bun run test:integration`.")
	return current
}

export const newAccount = newSponsoredAccount

async function openWallet(node: AztecNode, m: BridgeManifest): Promise<EmbeddedWallet> {
	const wallet = await openBridgeWallet(node, { prove: false })
	cleanup.push(() => wallet.stop())
	await registerSponsor(wallet, m)
	await registerBridgeContracts(wallet, m)
	return wallet
}

/** The heartbeat runs in a wallet of its own, so its txs never land in `sent`. */
async function startHeartbeat(node: AztecNode, m: BridgeManifest): Promise<void> {
	cleanup.push(await startBlockHeartbeat(await openWallet(node, m), m))
}

async function open(log: (m: string) => void): Promise<Harness> {
	const runId = runIdFor({ RUN_ID: process.env.RUN_ID ?? `it-${process.pid}` })
	cleanup.push(
		() => rmSync(forgeRunDir(runId), { recursive: true, force: true }),
		() => rmSync(localDeploymentDir(runId), { recursive: true, force: true }),
	)
	if (!(process.env.NET_L1_RPC && process.env.NET_NODE_URL)) {
		cleanup.push(() => netDown(runId, log))
		await netUp(runId, log)
	}
	const { manifest } = await deployLocal(runId, log)
	cleanup.push(enterOwnedTmpDir())
	const net = resolveEndpoints(runId)
	const node = createAztecNodeClient(net.nodeUrl)
	const sent: SentTx[] = []
	const wallet = await openWallet(recordingNode(node, sent), manifest)
	const owner = (await wallet.createSchnorrAccount(LOCAL_DEPLOYER_SECRET, Fr.ZERO, signingKeyFor(LOCAL_DEPLOYER_SECRET))).address
	await startHeartbeat(node, manifest)
	const chain = l1Chain(net.anvilUrl, L1_CHAIN_ID)
	const publicClient = createPublicClient({ chain, transport: http(net.anvilUrl) }) as PublicClient
	const test = createTestClient({ chain, mode: "anvil", transport: http(net.anvilUrl) })
	log(`harness open: run ${runId}, bridge ${manifest.l2.bridge.address}`)
	return {
		manifest,
		node,
		wallet,
		sent,
		owner,
		outbox: outboxReader(publicClient, manifest.l1.outbox),
		l1: { rpcUrl: net.anvilUrl, chain, publicClient, test },
	}
}

export async function openHarness(log: (m: string) => void): Promise<void> {
	try {
		current = await open(log)
	} catch (e) {
		await closeHarness().catch((c) => log(`teardown after a failed open also failed: ${c}`))
		throw e
	}
}

/** Undoes every setup step in reverse, each even if an earlier one failed. */
export async function closeHarness(): Promise<void> {
	current = undefined
	const failures: unknown[] = []
	for (const step of cleanup.splice(0).reverse()) {
		try {
			await step()
		} catch (e) {
			failures.push(e)
		}
	}
	if (failures.length > 0) throw new AggregateError(failures, "integration teardown failed")
}
