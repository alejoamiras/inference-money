import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { Fr } from "@aztec/aztec.js/fields"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { EmbeddedWallet } from "@aztec/wallets/embedded"
import {
	authorizeLegacyHandshakeReads,
	type BridgeManifest,
	registerLegacyHandshakeRegistry,
	sponsoredFpcArtifact,
	sponsorInstance,
} from "@inference-money/bridge-core"
import { ANVIL_ACCOUNTS, L1_CHAIN_ID, resolveEndpoints } from "@inference-money/local-network"
import type { Hex } from "viem"
import { mnemonicToAccount } from "viem/accounts"
import { deployBridge } from "./deploy"
import { deployMockUsdc } from "./deploy-l1"
import { buildBridgeContracts } from "./evm"
import { installCanonicalPermit2, l1Signer } from "./l1"
import { localManifestPath, readManifest, writeManifest } from "./manifest"
import { withOwnedTmpDir } from "./owned-tmp"
import type { Check } from "./preflight"
import { scrubbedEnv } from "./secrets"
import { verifyDeployment } from "./verify"

/** Anvil's public test mnemonic: the local network's own keys, not a credential. */
const ANVIL_MNEMONIC = "test test test test test test test test test test test junk"
/**
 * The local L1 deployer signs from anvil's last funded index: index 0 is the node's block publisher, and sharing it
 * would race every write on one nonce.
 */
export const localL1Account = () => mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: ANVIL_ACCOUNTS - 1 })
/** A fixed local-only secret (like anvil's keys), so every process of a run can rebuild the L2 owner account. */
export const LOCAL_DEPLOYER_SECRET = new Fr(0x1a7e0de9107e5n)

export class VerificationFailed extends Error {
	constructor(readonly failures: Check[]) {
		super(`verification failed: ${failures.map((c) => `${c.name}: ${c.detail}`).join("; ")}`)
		this.name = "VerificationFailed"
	}
}

function assertAllPass(checks: Check[], log: (m: string) => void): void {
	for (const c of checks) log(`${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail}`)
	const failures = checks.filter((c) => !c.ok)
	if (failures.length > 0) throw new VerificationFailed(failures)
}

/**
 * Ephemeral wallet, no proving (a local correctness loop), key stores in an owner-only dir removed afterwards. It can
 * execute the 5.0.0 sponsor (see bridge-core's compat).
 */
async function withLocalWallet<T>(nodeUrl: string, fn: (w: EmbeddedWallet, node: ReturnType<typeof createAztecNodeClient>) => Promise<T>) {
	return withOwnedTmpDir(async () => {
		const node = createAztecNodeClient(nodeUrl)
		const wallet = await EmbeddedWallet.create(node, {
			ephemeral: true,
			pxe: { proverEnabled: false, hooks: { authorizeUtilityCall: authorizeLegacyHandshakeReads } },
		})
		try {
			await registerLegacyHandshakeRegistry(wallet)
			return await fn(wallet, node)
		} finally {
			await wallet.stop()
		}
	})
}

/** Deploys the bridge onto this run's local network, verifies every read-back, and only then writes the manifest. */
export async function deployLocal(runId: string, log: (m: string) => void): Promise<{ manifest: BridgeManifest; path: string }> {
	const net = resolveEndpoints(runId)
	const evm = buildBridgeContracts(runId, false, scrubbedEnv())
	const l1 = l1Signer(net.anvilUrl, L1_CHAIN_ID, localL1Account())
	const permit2 = await installCanonicalPermit2(l1)
	const usdc = (await deployMockUsdc(l1, evm)).address
	log(`L1 deployer ${l1.account.address}; Permit2 ${permit2}; MockUsdc ${usdc}`)
	const manifest = await withLocalWallet(net.nodeUrl, async (wallet, node) => {
		const sponsor = await sponsorInstance()
		await wallet.registerContract(sponsor, sponsoredFpcArtifact)
		const sponsored = new SponsoredFeePaymentMethod(sponsor.address)
		const fees = { accountDeploy: async () => sponsored, tx: sponsored }
		const m = await deployBridge({
			network: "local",
			l1,
			evm,
			node,
			nodeUrl: net.nodeUrl,
			wallet,
			usdc,
			permit2,
			deployerSecret: LOCAL_DEPLOYER_SECRET,
			fees,
			sponsoredFpc: sponsor.address.toString() as Hex,
			log,
		})
		assertAllPass(await verifyDeployment(m, evm, l1.publicClient, node, l1.account.address), log)
		return m
	})
	const path = localManifestPath(runId)
	writeManifest(path, manifest)
	return { manifest, path }
}

/** Re-verifies this run's written manifest against a fresh `forge build --force`. */
export async function verifyLocal(runId: string, log: (m: string) => void): Promise<void> {
	const net = resolveEndpoints(runId)
	const manifest = readManifest(localManifestPath(runId))
	const evm = buildBridgeContracts(runId, true, scrubbedEnv())
	const l1 = l1Signer(net.anvilUrl, L1_CHAIN_ID, localL1Account())
	const node = createAztecNodeClient(net.nodeUrl)
	assertAllPass(await verifyDeployment(manifest, evm, l1.publicClient, node, l1.account.address), log)
}
