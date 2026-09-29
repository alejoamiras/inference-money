import { rmSync } from "node:fs"
import { join } from "node:path"
import type { AztecAddress } from "@aztec/aztec.js/addresses"
import { FeeJuicePaymentMethodWithClaim } from "@aztec/aztec.js/fee"
import { Fr } from "@aztec/aztec.js/fields"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { type BridgeManifest, sponsoredFpcArtifact, sponsorInstance } from "@inference-money/bridge-core"
import { REPO_ROOT } from "@inference-money/local-network"
import { privateKeyToAccount } from "viem/accounts"
import { deployBridge } from "./deploy"
import type { L2Fees } from "./deploy-l2"
import { type BridgeEvmArtifacts, buildBridgeContracts, forgeRunDir } from "./evm"
import { bridgeFeeJuice } from "./fee-juice"
import { type L1Signer, l1Signer } from "./l1"
import { readManifest, writeManifest } from "./manifest"
import { type NetworkPins, TESTNET } from "./networks"
import { probeNetwork } from "./preflight"
import { loadTestnetSecrets, scrubbedEnv, type TestnetSecrets } from "./secrets"
import { assertAllPass, verifyDeployment } from "./verify"
import { withBridgeWallet } from "./wallet"

export const TESTNET_MANIFEST = join(REPO_ROOT, "deployments", "testnet.json")

/**
 * Always `--force` into a forge dir of this invocation's own, removed once the artifacts are in memory: no stale cache
 * or concurrent testnet command can reach a live deploy.
 */
function buildFresh(): BridgeEvmArtifacts {
	const run = `testnet-${process.pid}`
	try {
		return buildBridgeContracts(run, true, scrubbedEnv())
	} finally {
		rmSync(forgeRunDir(run), { recursive: true, force: true })
	}
}

export interface TestnetContext {
	pins: NetworkPins
	secrets: TestnetSecrets
	l1RpcUrl: string
	l1: L1Signer
}

export function testnetContext(): TestnetContext {
	const pins = TESTNET
	const secrets = loadTestnetSecrets(REPO_ROOT)
	const l1RpcUrl = secrets.sepoliaRpcUrl ?? pins.defaultL1RpcUrl
	return { pins, secrets, l1RpcUrl, l1: l1Signer(l1RpcUrl, pins.l1ChainId, privateKeyToAccount(secrets.l1PrivateKey)) }
}

/**
 * The deployer account's first tx claims Fee Juice minted from the testnet faucet and bridged to it; every later tx
 * pays from that balance.
 */
function selfFundedFees(c: TestnetContext, node: ReturnType<typeof createAztecNodeClient>, log: (m: string) => void): L2Fees {
	return {
		accountDeploy: async (account: AztecAddress) => {
			const claim = await bridgeFeeJuice({
				node,
				l1RpcUrl: c.l1RpcUrl,
				l1PrivateKey: c.secrets.l1PrivateKey,
				l1ChainId: c.pins.l1ChainId,
				to: account,
				log,
			})
			return new FeeJuicePaymentMethodWithClaim(account, claim)
		},
		tx: undefined,
	}
}

/**
 * Probes the pins (nothing is spent unless every one holds), deploys with real client proofs, verifies every read-back,
 * and only then writes `deployments/testnet.json`.
 */
export async function deployTestnet(log: (m: string) => void): Promise<BridgeManifest> {
	const c = testnetContext()
	assertAllPass(await probeNetwork(c.pins, c.l1RpcUrl), log)
	const evm = buildFresh()
	const manifest = await withBridgeWallet(c.pins.nodeUrl, { prove: true }, async (wallet, node) => {
		const sponsor = await sponsorInstance()
		if (sponsor.address.toString() !== c.pins.sponsoredFpc) throw new Error(`the pinned sponsor derives to ${sponsor.address}`)
		await wallet.registerContract(sponsor, sponsoredFpcArtifact)
		const m = await deployBridge({
			network: "testnet",
			l1: c.l1,
			evm,
			node,
			nodeUrl: c.pins.nodeUrl,
			wallet,
			usdc: c.pins.usdc,
			permit2: c.pins.permit2,
			deployerSecret: Fr.fromHexString(c.secrets.aztecSecretKey),
			fees: selfFundedFees(c, node, log),
			sponsoredFpc: c.pins.sponsoredFpc,
			log,
		})
		assertAllPass(await verifyDeployment(m, evm, c.l1.publicClient, node, c.l1.account.address), log)
		return m
	})
	writeManifest(TESTNET_MANIFEST, manifest)
	return manifest
}

/** Re-verifies the committed testnet manifest against the live chains and a fresh `forge build --force`. */
export async function verifyTestnet(log: (m: string) => void): Promise<void> {
	const c = testnetContext()
	const manifest = readManifest(TESTNET_MANIFEST)
	const evm = buildFresh()
	const node = createAztecNodeClient(manifest.l2.nodeUrl)
	assertAllPass(await verifyDeployment(manifest, evm, c.l1.publicClient, node, c.l1.account.address), log)
}
