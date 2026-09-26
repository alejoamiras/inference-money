import { describe, expect, it } from "bun:test"
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assertOwnerOnly, containsSecret, parseEnvFile, parseTestnetSecrets, scrubbedEnv } from "./secrets"

const KEY: `0x${string}` = `0x${"0b".repeat(32)}`

describe("testnet secrets", () => {
	it("parses keys, strips quotes and export prefixes, ignores comments", () => {
		const env = parseEnvFile(
			`# c\nexport TESTNET_L1_PRIVATE_KEY="${KEY}"\nTESTNET_AZTEC_SECRET_KEY=${KEY}\n\nSEPOLIA_RPC_URL='https://x'\n`,
		)
		expect(parseTestnetSecrets(env)).toEqual({ l1PrivateKey: KEY, aztecSecretKey: KEY, sepoliaRpcUrl: "https://x" })
	})

	it("names a malformed or out-of-range key without echoing its value", () => {
		const aboveField = `0x${"ab".repeat(32)}`
		for (const [name, bad] of [
			["TESTNET_L1_PRIVATE_KEY", "0xdeadbeefsecret"],
			["TESTNET_L1_PRIVATE_KEY", `0x${"00".repeat(32)}`],
			["TESTNET_AZTEC_SECRET_KEY", aboveField],
		] as const) {
			const run = () =>
				parseTestnetSecrets(
					new Map([
						["TESTNET_L1_PRIVATE_KEY", KEY],
						[name, bad],
					]),
				)
			expect(run).toThrow(new RegExp(name))
			expect(run).not.toThrow(new RegExp(bad.slice(2)))
		}
	})

	it("scrubs credential-bearing variables from a child env, keeping the rest", () => {
		const env = scrubbedEnv({ PATH: "/bin", HOME: "/h", TESTNET_L1_PRIVATE_KEY: KEY, SEPOLIA_RPC_URL: "https://k", MNEMONIC: "m" })
		expect(env).toEqual({ PATH: "/bin", HOME: "/h" })
	})

	it("detects a secret in any case, with or without its prefix, and nothing else", () => {
		const s = { l1PrivateKey: KEY, aztecSecretKey: `0x${"cd".repeat(32)}` as const, sepoliaRpcUrl: "https://rpc/key123" }
		expect(containsSecret(`log: ${KEY.slice(2).toUpperCase()}`, s)).toBe(true)
		expect(containsSecret("url https://RPC/KEY123 used", s)).toBe(true)
		expect(containsSecret(`tx 0x${"ab".repeat(31)}ff`, s)).toBe(false)
	})

	it("refuses a key file readable by group or others", () => {
		const path = join(mkdtempSync(join(tmpdir(), "secrets-")), ".env.testnet")
		writeFileSync(path, "")
		chmodSync(path, 0o644)
		expect(() => assertOwnerOnly(path)).toThrow(/chmod 600/)
		chmodSync(path, 0o600)
		expect(() => assertOwnerOnly(path)).not.toThrow()
	})
})
