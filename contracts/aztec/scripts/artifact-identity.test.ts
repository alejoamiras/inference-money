import { describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { NoirCompiledContract } from "@aztec/stdlib/noir"
import { artifactIdentity, identityDiff } from "./artifact-identity"

const BRIDGE = new URL("../token_bridge/target/token_bridge_contract-TokenBridge.json", import.meta.url).pathname
const CLI = new URL("./artifact-identity.ts", import.meta.url).pathname

describe("artifactIdentity", () => {
	it("catches a public-function rename that leaves the class id unchanged, and `compare` exits 1 on it", async () => {
		const json = (await Bun.file(BRIDGE).json()) as NoirCompiledContract
		const want = await artifactIdentity(json)
		const renamed = structuredClone(json)
		const fn = renamed.functions.find((f) => f.name === "claim_public")
		if (!fn) throw new Error("fixture lost claim_public")
		fn.name = "claim_publik"
		const got = await artifactIdentity(renamed)

		expect(identityDiff(want, want)).toEqual([])
		expect(got.classId).toBe(want.classId)
		expect(identityDiff(want, got)).toEqual([expect.stringContaining("ABI differs")])

		const dir = mkdtempSync(join(tmpdir(), "artifact-identity-"))
		try {
			const mutated = join(dir, "mutated.json")
			await Bun.write(mutated, JSON.stringify(renamed))
			const compare = (b: string) => Bun.spawnSync(["bun", CLI, "compare", BRIDGE, b], { stderr: "pipe" })
			expect(compare(BRIDGE).exitCode).toBe(0)
			const drifted = compare(mutated)
			expect(drifted.exitCode).toBe(1)
			expect(drifted.stderr.toString()).toContain("ABI differs")
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	}, 30_000)
})
