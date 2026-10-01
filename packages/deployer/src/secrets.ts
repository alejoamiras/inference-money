import { Fr } from "@aztec-labs/aztec.js/fields"
import type { Hex } from "viem"

/**
 * The keyed-run variables. Each reaches only the environment of the one process a keyed run approved (env-exec) or a
 * `disposable exec` child, and is read from there alone: never from a file, never from argv.
 */
export const KEYED = {
	l1PrivateKey: "TESTNET_L1_PRIVATE_KEY",
	deployerSecret: "TESTNET_DEPLOYER_SECRET",
	adminSecret: "TESTNET_ADMIN_SECRET",
	rpcUrl: "SEPOLIA_RPC_URL",
} as const

const HEX32 = /^0x[0-9a-fA-F]{64}$/
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n

/** Range-checked here because the libraries that reject an out-of-range key echo it in their error. */
function scalar(name: string, env: NodeJS.ProcessEnv, bound: bigint): Hex {
	const value = env[name] ?? ""
	if (!HEX32.test(value)) throw new Error(`${name} is missing or not 32-byte 0x-hex`)
	const n = BigInt(value)
	if (n === 0n || n >= bound) throw new Error(`${name} is out of range for its curve`)
	return value as Hex
}

export const l1PrivateKeyFrom = (env: NodeJS.ProcessEnv = process.env): Hex => scalar(KEYED.l1PrivateKey, env, SECP256K1_N)

/** An Aztec account or deployer secret: a field element, as `op-remote`'s `generate fr` draws it. */
export const aztecSecretFrom = (name: typeof KEYED.deployerSecret | typeof KEYED.adminSecret, env: NodeJS.ProcessEnv = process.env): Fr =>
	Fr.fromHexString(scalar(name, env, Fr.MODULUS))

const SECRET_NAME = /PRIVATE_KEY|SECRET|MNEMONIC|PASSWORD|TOKEN|RPC_URL|API_KEY/i
/** env-exec refuses shorter secret values, and a shorter needle would redact ordinary text. */
const MIN_SECRET = 8

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

const forms = (value: string): string[] =>
	/^0x[0-9a-f]+$/i.test(value) ? [value, value.slice(2)] : /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? urlForms(value) : [value]

/**
 * Every credential-named variable of `env` in every form text could carry it, longest first, lowercased: hex with and
 * without 0x, and every URL form. A keyless environment yields none.
 */
export function secretNeedles(env: NodeJS.ProcessEnv = process.env): string[] {
	const values = Object.entries(env).flatMap(([k, v]) => (SECRET_NAME.test(k) && v && v.length >= MIN_SECRET ? [v] : []))
	return [...new Set(values.flatMap(forms).map((n) => n.toLowerCase()))].sort((a, b) => b.length - a.length)
}

/** Whether `text` holds any needle, in any case. Answers only yes or no. */
export function containsSecret(text: string, needles: readonly string[]): boolean {
	const haystack = text.toLowerCase()
	return needles.some((n) => haystack.includes(n))
}
