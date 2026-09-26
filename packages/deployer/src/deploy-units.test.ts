import { describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { Fr } from "@aztec/aztec.js/fields"
import { MANIFEST } from "../../bridge-core/src/test/fixtures"
import { signingKeyFor } from "./deploy-l2"
import { maskImmutables } from "./evm"
import { readManifest, writeManifest } from "./manifest"

describe("deploy units", () => {
	it("masks exactly the immutable ranges, so any other byte difference still fails the bytecode match", () => {
		const ranges = [{ start: 1, length: 2 }]
		expect(maskImmutables("0xaabbccdd", ranges)).toBe("0xaa0000dd")
		expect(maskImmutables("0xaa1122dd", ranges)).toBe(maskImmutables("0xaabbccdd", ranges))
		expect(maskImmutables("0xaabbccde", ranges)).not.toBe(maskImmutables("0xaabbccdd", ranges))
	})

	it("derives one signing key per secret, the same every time", () => {
		const a = new Fr(1n)
		expect(signingKeyFor(a).equals(signingKeyFor(new Fr(1n)))).toBe(true)
		expect(signingKeyFor(a).equals(signingKeyFor(new Fr(2n)))).toBe(false)
	})

	it("writes only a valid manifest, and reads it back unchanged", () => {
		const dir = mkdtempSync(join(homedir(), ".cache", "inference-money-manifest-test-"))
		try {
			const path = join(dir, "local", "r", "manifest.json")
			expect(() => writeManifest(path, { ...MANIFEST, l1: { ...MANIFEST.l1, chainId: 0 } })).toThrow("failed validation")
			expect(existsSync(path)).toBe(false)
			writeManifest(path, MANIFEST)
			expect(readManifest(path)).toEqual(MANIFEST)
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})
