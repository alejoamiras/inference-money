import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { loadContractArtifact } from "@aztec-labs/aztec.js/abi"
import type { ContractArtifact } from "@aztec-labs/stdlib/abi"
import { type BridgeManifest, instanceFromRecord, PERMIT2_DEPOSIT_ROUTER_ABI, TOKEN_PORTAL_ABI } from "@inference-money/bridge-core"
import { REPO_ROOT } from "@inference-money/local-network"
import { readManifest, writeManifest } from "./manifest"

/** The committed, transpiled Aztec artifacts, under the manifest's instance keys. */
const ARTIFACTS = {
	proxy: "contracts/aztec/token_minter_proxy/target/token_minter_proxy-TokenMinterProxy.json",
	token: "contracts/aztec/token/target/merchant_token-Token.json",
	bridge: "contracts/aztec/token_bridge/target/token_bridge_contract-TokenBridge.json",
} as const
type Key = keyof typeof ARTIFACTS
const KEYS = Object.keys(ARTIFACTS) as Key[]

const readme = (m: BridgeManifest) => `# Bridge integration bundle

The ${m.network} deployment of bridge \`${m.l2.bridge.address}\`, deployed from commit \`${m.sourceCommit}\`.

- \`manifest.json\`: every address and instance record. \`instanceFromRecord(artifact, manifest.l2.<key>)\` re-derives each
  instance and refuses an artifact that does not land on the recorded address.
- \`aztec/{proxy,token,bridge}.json\`: the Aztec contract artifacts, as compiled at that commit.
- \`ethereum/{TokenPortal,Permit2DepositRouter}.abi.json\`: the L1 functions and events an integration calls.

Who may do what, every refusal, the message formats and what each action makes public: \`docs/integration.md\` at that
commit. Before trusting an address here, run \`bun run bridge verify <manifest>\` against your own endpoints.
`

/** Everything an integrator needs from one deployment, written into `out`; returns the files written. */
export function exportBundle(m: BridgeManifest, out: string): string[] {
	mkdirSync(join(out, "aztec"), { recursive: true })
	mkdirSync(join(out, "ethereum"), { recursive: true })
	writeManifest(join(out, "manifest.json"), m)
	for (const key of KEYS) copyFileSync(join(REPO_ROOT, ARTIFACTS[key]), join(out, "aztec", `${key}.json`))
	const json = (v: unknown) => `${JSON.stringify(v, null, "\t")}\n`
	writeFileSync(join(out, "ethereum", "TokenPortal.abi.json"), json(TOKEN_PORTAL_ABI))
	writeFileSync(join(out, "ethereum", "Permit2DepositRouter.abi.json"), json(PERMIT2_DEPOSIT_ROUTER_ABI))
	writeFileSync(join(out, "README.md"), readme(m))
	return [
		"manifest.json",
		...KEYS.map((k) => `aztec/${k}.json`),
		"ethereum/TokenPortal.abi.json",
		"ethereum/Permit2DepositRouter.abi.json",
		"README.md",
	]
}

export interface Bundle {
	manifest: BridgeManifest
	artifacts: Record<Key, ContractArtifact>
}

/** Reads a bundle back, each artifact checked to derive the instance its manifest records. */
export async function readBundle(dir: string): Promise<Bundle> {
	const manifest = readManifest(join(dir, "manifest.json"))
	const entries = await Promise.all(
		KEYS.map(async (key): Promise<[Key, ContractArtifact]> => {
			const artifact = loadContractArtifact(JSON.parse(readFileSync(join(dir, "aztec", `${key}.json`), "utf8")))
			await instanceFromRecord(artifact, manifest.l2[key])
			return [key, artifact]
		}),
	)
	return { manifest, artifacts: Object.fromEntries(entries) as Record<Key, ContractArtifact> }
}
