import { readFileSync } from "node:fs"
import { basename, dirname, resolve } from "node:path"
import { type BridgeManifest, parseManifest } from "@inference-money/bridge-core/manifest"
import { readDemoFile } from "@inference-money/demo/files"
import { TESTNET } from "@inference-money/deployer/networks"
import { resolveEndpoints } from "@inference-money/local-network/handle"

export type Proofs = "real" | "fake"

/** What one build embeds. There is no runtime override: the bundle knows exactly one network. */
export interface BuildTarget {
	readonly manifest: BridgeManifest
	/** The published tag the demo's user accounts derive from. */
	readonly usersTag: string
	/** A public endpoint the page reads and sends L1 through, never a keyed run's SEPOLIA_RPC_URL. */
	readonly l1RpcUrl: string
	readonly proofs: Proofs
}

export const TESTNET_MANIFEST = "deployments/testnet.json"
/** Written beside the bundle: the exact string `__BRIDGE_MANIFEST__` was defined as. */
export const EMBEDDED_MANIFEST = "bridge-manifest.json"
/** A keyed run's variables: a build that sees one refuses to run, so no secret can reach a bundle. */
const KEYED = ["TESTNET_L1_PRIVATE_KEY", "TESTNET_DEPLOYER_SECRET", "TESTNET_ADMIN_SECRET", "SEPOLIA_RPC_URL"]
/** bb.js fetches its proving key material from these, a host it hardcodes and its fallback. */
const CRS_ORIGINS = ["https://crs.aztec-cdn.foundation", "https://crs.aztec-labs.com"]

type Env = Readonly<Record<string, string | undefined>>

function readManifestFile(path: string): BridgeManifest {
	let raw: string
	try {
		raw = readFileSync(path, "utf8")
	} catch {
		throw new Error(`No bridge manifest at ${path}. Deploy first, or point BRIDGE_MANIFEST at a deployed manifest.`)
	}
	return parseManifest(JSON.parse(raw))
}

/** Testnet always proves for real; a local build fakes proofs unless SHOWCASE_PROOFS=real (the proving harness). */
function proofsFor(env: Env, m: BridgeManifest): Proofs {
	const p = env.SHOWCASE_PROOFS ?? (m.network === "testnet" ? "real" : "fake")
	if (p !== "real" && p !== "fake") throw new Error(`SHOWCASE_PROOFS is "real" or "fake", not "${p}"`)
	if (m.network === "testnet" && p !== "real") throw new Error("A testnet build proves for real.")
	return p
}

/** A local run's anvil, from its network handle; testnet's pinned public endpoint. */
const l1RpcFor = (path: string, m: BridgeManifest, env: Env): string =>
	m.network === "local" ? resolveEndpoints(basename(dirname(path)), env as NodeJS.ProcessEnv).anvilUrl : TESTNET.defaultL1RpcUrl

/**
 * Resolves what a build embeds. `BRIDGE_TARGET=testnet` pins the committed testnet manifest and refuses every override;
 * otherwise `BRIDGE_MANIFEST` names the file (repo-relative or absolute), defaulting to the testnet one. The deployment's
 * published demo must sit beside it.
 */
export function resolveTarget(env: Env, repoRoot: string): BuildTarget {
	const keyed = KEYED.filter((name) => env[name])
	if (keyed.length > 0) throw new Error(`The showcase builds keyless: unset ${keyed.join(", ")}.`)
	const pinned = env.BRIDGE_TARGET === "testnet"
	if (env.BRIDGE_TARGET !== undefined && !pinned) throw new Error(`Unknown BRIDGE_TARGET "${env.BRIDGE_TARGET}"`)
	if (pinned && env.BRIDGE_MANIFEST) throw new Error(`The testnet build embeds ${TESTNET_MANIFEST} only: unset BRIDGE_MANIFEST.`)
	const path = resolve(repoRoot, pinned ? TESTNET_MANIFEST : (env.BRIDGE_MANIFEST ?? TESTNET_MANIFEST))
	const manifest = readManifestFile(path)
	if (pinned && manifest.network !== "testnet") throw new Error(`${TESTNET_MANIFEST} is a ${manifest.network} manifest`)
	const demo = readDemoFile({ path, m: manifest })
	if (!demo) throw new Error(`${path} has no published demo: run \`bun run bridge demo setup ${path}\` first.`)
	return { manifest, usersTag: demo.usersTag, l1RpcUrl: l1RpcFor(path, manifest, env), proofs: proofsFor(env, manifest) }
}

/** Frames nothing, and talks to nothing but itself, the Aztec node, the L1 RPC and, when it proves, bb.js's CRS hosts. */
export function cspFor(t: BuildTarget): string {
	const origins = [t.manifest.l2.nodeUrl, t.l1RpcUrl].map((u) => new URL(u).origin)
	const connect = [...origins, ...(t.proofs === "real" ? CRS_ORIGINS : [])]
	return [
		"default-src 'self'",
		"img-src 'self' data:",
		"font-src 'self'",
		"style-src 'self' 'unsafe-inline'",
		"script-src 'self' 'wasm-unsafe-eval'",
		"worker-src 'self' blob:",
		// bb.js fetches its own wasm from a data: URL.
		`connect-src 'self' data: blob: ${connect.join(" ")}`,
		"frame-src 'none'",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'none'",
		"frame-ancestors 'none'",
	].join("; ")
}

/** bb.js runs threaded wasm, which needs cross-origin isolation. */
export const ISOLATION_HEADERS = {
	"Cross-Origin-Opener-Policy": "same-origin",
	"Cross-Origin-Embedder-Policy": "require-corp",
} as const

export function servedHeaders(t: BuildTarget): Record<string, string> {
	return {
		...ISOLATION_HEADERS,
		"Content-Security-Policy": cspFor(t),
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options": "DENY",
		"Referrer-Policy": "no-referrer",
		"Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
	}
}

/** The Workers static-assets `_headers` file: every path gets the served headers. */
export function headersFile(t: BuildTarget): string {
	const lines = Object.entries(servedHeaders(t)).map(([k, v]) => `  ${k}: ${v}`)
	return `/*\n${lines.join("\n")}\n`
}
