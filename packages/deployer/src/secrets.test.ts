import { describe, expect, it } from "bun:test"
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assertOwnerOnly, parseEnvFile, parseTestnetSecrets } from "./secrets"

const KEY: `0x${string}` = `0x${"ab".repeat(32)}`

describe("testnet secrets", () => {
	it("parses keys, strips quotes and export prefixes, ignores comments", () => {
		const env = parseEnvFile(
			`# c\nexport TESTNET_L1_PRIVATE_KEY="${KEY}"\nTESTNET_AZTEC_SECRET_KEY=${KEY}\n\nSEPOLIA_RPC_URL='https://x'\n`,
		)
		expect(parseTestnetSecrets(env)).toEqual({ l1PrivateKey: KEY, aztecSecretKey: KEY, sepoliaRpcUrl: "https://x" })
	})

	it("names a malformed key without echoing its value", () => {
		const bad = "0xdeadbeefsecret"
		const run = () => parseTestnetSecrets(new Map([["TESTNET_L1_PRIVATE_KEY", bad]]))
		expect(run).toThrow(/TESTNET_L1_PRIVATE_KEY/)
		expect(run).not.toThrow(new RegExp(bad))
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
