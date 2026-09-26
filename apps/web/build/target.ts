import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { type BridgeManifest, parseManifest } from "@inference-money/bridge-core/manifest"

/** What one build embeds. There is no runtime override: the bundle knows exactly one network. */
export interface BuildTarget {
	readonly manifest: BridgeManifest
	/** Iframe wallet URLs; only the local e2e test wallets, never a shipped build. */
	readonly webWalletUrls: readonly string[]
}

export const TESTNET_MANIFEST = "deployments/testnet.json"

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

function parseWalletUrls(raw: string | undefined): string[] {
	const urls = (raw ?? "")
		.split(",")
		.map((u) => u.trim())
		.filter(Boolean)
	for (const u of urls) {
		const { protocol } = new URL(u)
		if (protocol !== "http:" && protocol !== "https:") throw new Error(`WEB_WALLET_URLS: ${u} is not an http(s) URL`)
	}
	return urls
}

/**
 * Resolves the manifest a build embeds. `BRIDGE_TARGET=testnet` pins the committed testnet manifest and refuses every
 * override; otherwise `BRIDGE_MANIFEST` names the file (repo-relative or absolute), defaulting to the testnet one.
 */
export function resolveTarget(env: Env, repoRoot: string): BuildTarget {
	const pinned = env.BRIDGE_TARGET === "testnet"
	if (env.BRIDGE_TARGET !== undefined && !pinned) throw new Error(`Unknown BRIDGE_TARGET "${env.BRIDGE_TARGET}"`)
	if (pinned && (env.BRIDGE_MANIFEST || env.WEB_WALLET_URLS)) {
		throw new Error(`The testnet build embeds ${TESTNET_MANIFEST} only: unset BRIDGE_MANIFEST and WEB_WALLET_URLS.`)
	}
	const manifest = readManifestFile(resolve(repoRoot, pinned ? TESTNET_MANIFEST : (env.BRIDGE_MANIFEST ?? TESTNET_MANIFEST)))
	if (pinned && manifest.network !== "testnet") throw new Error(`${TESTNET_MANIFEST} is a ${manifest.network} manifest`)
	const webWalletUrls = parseWalletUrls(env.WEB_WALLET_URLS)
	if (webWalletUrls.length > 0 && manifest.network !== "local") {
		throw new Error("WEB_WALLET_URLS is a local test fixture; a testnet build lists no iframe wallets.")
	}
	return { manifest, webWalletUrls }
}

/** Frames nothing but the listed test wallets, talks to nothing but itself and the manifest's Aztec node. */
export function cspFor(t: BuildTarget): string {
	const frames = t.webWalletUrls.map((u) => new URL(u).origin)
	return [
		"default-src 'self'",
		"img-src 'self' data:",
		"font-src 'self'",
		"style-src 'self' 'unsafe-inline'",
		"script-src 'self' 'wasm-unsafe-eval'",
		"worker-src 'self' blob:",
		// bb.js fetches its own wasm from a data: URL.
		`connect-src 'self' data: blob: ${new URL(t.manifest.l2.nodeUrl).origin}`,
		`frame-src ${frames.length > 0 ? frames.join(" ") : "'none'"}`,
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
