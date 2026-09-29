import { describe, expect, it } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { resolveToolchain } from "./network"

/** A repo root pinning `pinned`, and a node install at `base` holding `installed` with the given executables. */
function fixture(pinned: string, installed: string, bins = ["internal-bin/anvil", "internal-bin/forge", "node_modules/.bin/aztec"]) {
	const dir = mkdtempSync(join(homedir(), ".cache", "inference-money-toolchain-test-"))
	const root = join(dir, "repo")
	const base = join(dir, "node")
	mkdirSync(root)
	writeFileSync(join(root, "toolchain.json"), JSON.stringify({ aztecNode: pinned }))
	for (const bin of bins) {
		mkdirSync(dirname(join(base, bin)), { recursive: true })
		writeFileSync(join(base, bin), "#!/bin/sh\n")
		chmodSync(join(base, bin), 0o755)
	}
	mkdirSync(join(base, "node_modules", "@aztec", "aztec"), { recursive: true })
	writeFileSync(join(base, "node_modules", "@aztec", "aztec", "package.json"), JSON.stringify({ version: installed }))
	return { dir, root, env: { AZTEC_NODE_HOME: base }, base }
}

describe("resolveToolchain", () => {
	it("takes AZTEC_NODE_HOME only when it is a complete install of exactly the pinned node", () => {
		const ok = fixture("5.0.0", "5.0.0")
		const drifted = fixture("5.0.0", "5.0.1")
		const partial = fixture("5.0.0", "5.0.0", ["internal-bin/anvil", "node_modules/.bin/aztec"])
		try {
			expect(resolveToolchain(ok.root, ok.env)).toMatchObject({ version: "5.0.0", anvil: join(ok.base, "internal-bin", "anvil") })
			expect(() => resolveToolchain(drifted.root, drifted.env)).toThrow("holds aztec 5.0.1, not toolchain.json's 5.0.0")
			expect(() => resolveToolchain(partial.root, partial.env)).toThrow("incomplete (missing")
		} finally {
			for (const f of [ok, drifted, partial]) rmSync(f.dir, { recursive: true, force: true })
		}
	})
})
