import { readFileSync, statSync } from "node:fs"
import { resolve } from "node:path"
import type { Hex } from "viem"

export interface TestnetSecrets {
	l1PrivateKey: Hex
	aztecSecretKey: Hex
	sepoliaRpcUrl: string | undefined
}

const HEX32 = /^0x[0-9a-fA-F]{64}$/

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
	if (!HEX32.test(l1)) throw new Error("TESTNET_L1_PRIVATE_KEY is missing or not 32-byte 0x-hex")
	if (!HEX32.test(az)) throw new Error("TESTNET_AZTEC_SECRET_KEY is missing or not 32-byte 0x-hex")
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

/** Whether `text` holds any secret value, with or without its 0x prefix, in any case. Answers only yes or no. */
export function containsSecret(text: string, s: TestnetSecrets): boolean {
	const haystack = text.toLowerCase()
	const needles = [s.l1PrivateKey, s.aztecSecretKey].flatMap((v) => [v.toLowerCase(), v.slice(2).toLowerCase()])
	if (s.sepoliaRpcUrl) needles.push(s.sepoliaRpcUrl.toLowerCase())
	return needles.some((n) => haystack.includes(n))
}

export function loadTestnetSecrets(repoRoot: string): TestnetSecrets {
	const path = resolve(repoRoot, ".env.testnet")
	assertOwnerOnly(path)
	return parseTestnetSecrets(parseEnvFile(readFileSync(path, "utf8")))
}
