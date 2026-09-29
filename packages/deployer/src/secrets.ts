import { readFileSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { Fr } from "@aztec-labs/aztec.js/fields"
import type { Hex } from "viem"

export interface TestnetSecrets {
	l1PrivateKey: Hex
	aztecSecretKey: Hex
	sepoliaRpcUrl: string | undefined
}

const HEX32 = /^0x[0-9a-fA-F]{64}$/
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n

/** Range-checked here because the libraries that reject an out-of-range key echo it in their error. */
function assertScalar(name: string, value: string, bound: bigint): void {
	if (!HEX32.test(value)) throw new Error(`${name} is missing or not 32-byte 0x-hex`)
	const n = BigInt(value)
	if (n === 0n || n >= bound) throw new Error(`${name} is out of range for its curve`)
}

/** Parses dotenv-style `KEY=value` lines; quotes are stripped, comments and blanks skipped. */
export function parseEnvFile(text: string): Map<string, string> {
	const out = new Map<string, string>()
	for (const raw of text.split("\n")) {
		const line = raw.trim()
		if (line === "" || line.startsWith("#")) continue
		const eq = line.indexOf("=")
		if (eq <= 0) continue
		const key = line
			.slice(0, eq)
			.replace(/^export\s+/, "")
			.trim()
		out.set(key, line.slice(eq + 1).replace(/^["']|["']$/g, ""))
	}
	return out
}

/** Validates without echoing values: an error names the variable, never its content. */
export function parseTestnetSecrets(env: Map<string, string>): TestnetSecrets {
	const l1 = env.get("TESTNET_L1_PRIVATE_KEY") ?? ""
	const az = env.get("TESTNET_AZTEC_SECRET_KEY") ?? ""
	assertScalar("TESTNET_L1_PRIVATE_KEY", l1, SECP256K1_N)
	assertScalar("TESTNET_AZTEC_SECRET_KEY", az, Fr.MODULUS)
	return { l1PrivateKey: l1 as Hex, aztecSecretKey: az as Hex, sepoliaRpcUrl: env.get("SEPOLIA_RPC_URL") || undefined }
}

/** Refuses a key file any other local user could read. */
export function assertOwnerOnly(path: string): void {
	const mode = statSync(path).mode & 0o777
	if ((mode & 0o077) !== 0) throw new Error(`${path} is mode ${mode.toString(8)}; chmod 600 it before use`)
}

const SECRET_NAME = /PRIVATE_KEY|SECRET|MNEMONIC|PASSWORD|TOKEN|RPC_URL|API_KEY/i

/** The environment minus every variable that can carry a credential (an RPC URL often embeds an API key). */
export function scrubbedEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	return Object.fromEntries(Object.entries(env).filter(([k]) => !SECRET_NAME.test(k)))
}

/**
 * An RPC URL as libraries may print it: as given, normalized, and without its userinfo (viem strips it). Plus its
 * credential parts: the userinfo, the path + query (where providers put API keys, however short), and any segment or
 * query value long enough to be a key by itself.
 */
function urlForms(url: string): string[] {
	let u: URL
	try {
		u = new URL(url)
	} catch {
		return [url]
	}
	const bare = `${u.protocol}//${u.host}${u.pathname}${u.search}`
	const tail = `${u.pathname}${u.search}`
	const userinfo = [u.username, u.password, `${u.username}:${u.password}`].filter((p) => p.length >= 3)
	const parts = [...u.pathname.split("/"), ...u.searchParams.values()].filter((p) => p.length >= 8)
	return [url, u.href, bare, bare.replace(/\/$/, ""), ...(tail.length > 1 ? [tail] : []), ...userinfo, ...parts]
}

/** Every form a secret takes in text, longest first, lowercased: keys with and without 0x, and every URL form. */
export function secretNeedles(s: Partial<TestnetSecrets>, env: NodeJS.ProcessEnv = process.env): string[] {
	const keys = [s.l1PrivateKey, s.aztecSecretKey].flatMap((k) => (k ? [k, k.slice(2)] : []))
	const urls = [s.sepoliaRpcUrl, env.SEPOLIA_RPC_URL].flatMap((u) => (u ? urlForms(u) : []))
	return [...new Set([...keys, ...urls].map((n) => n.toLowerCase()))].sort((a, b) => b.length - a.length)
}

/** Whether `text` holds any secret, in any case. Answers only yes or no. */
export function containsSecret(text: string, s: TestnetSecrets): boolean {
	const haystack = text.toLowerCase()
	return secretNeedles(s, {}).some((n) => haystack.includes(n))
}

export function loadTestnetSecrets(repoRoot: string): TestnetSecrets {
	const path = resolve(repoRoot, ".env.testnet")
	assertOwnerOnly(path)
	return parseTestnetSecrets(parseEnvFile(readFileSync(path, "utf8")))
}
