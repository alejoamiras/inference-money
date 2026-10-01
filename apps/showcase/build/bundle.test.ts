// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const appRoot = fileURLToPath(new URL("..", import.meta.url))

/** The L1 wallet stack, the wallet-connect SDK and Aztec's L1 client library: never a dependency of the showcase. */
const BANNED = /^(wagmi|@wagmi\/[^/]+|@aztec-labs\/wallet-sdk|@aztec-labs\/ethereum)$/
/**
 * What the bundle may still hold of them, through the Aztec SDK: the embedded wallet's base class, and the config
 * schemas `@aztec-labs/stdlib`'s node types import. Their L1 clients and the connect surface stay out.
 */
const ALLOWED: Record<string, RegExp> = {
	"@aztec-labs/wallet-sdk": /^dest\/base-wallet\//,
	"@aztec-labs/ethereum": /^dest\/(config|l1_contract_addresses|l1_tx_utils\/config|contracts\/committee_attestations)\.js$/,
}

/** The banned modules among a bundle's sourcemap sources, as `<package>/<path>`. */
function bannedModules(sources: readonly string[]): string[] {
	return sources.flatMap((s) => {
		const m = s.match(/.*node_modules\/((?:@[^/]+\/)?[^/]+)\/(.*)$/)
		if (!m?.[1] || m[2] === undefined || !BANNED.test(m[1])) return []
		return ALLOWED[m[1]]?.test(m[2]) ? [] : [`${m[1]}/${m[2]}`]
	})
}

describe("banned packages", () => {
	it("are no dependency of the showcase", () => {
		const pkg = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8"))
		const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
		expect(deps.filter((d) => BANNED.test(d))).toEqual([])
	})

	it("are caught in a bundle's sources, except the base wallet and the SDK's config schemas", () => {
		const store = "../../node_modules/.bun/x@1/node_modules"
		const sources = [
			`${store}/wagmi/dist/esm/exports/index.js`,
			`${store}/@aztec-labs/wallet-sdk/dest/manager/wallet_manager.js`,
			`${store}/@aztec-labs/wallet-sdk/dest/base-wallet/base_wallet.js`,
			`${store}/@aztec-labs/ethereum/dest/l1_contract_addresses.js`,
			`${store}/@aztec-labs/ethereum/dest/client.js`,
			"../../src/App.tsx",
		]
		expect(bannedModules(sources)).toEqual([
			"wagmi/dist/esm/exports/index.js",
			"@aztec-labs/wallet-sdk/dest/manager/wallet_manager.js",
			"@aztec-labs/ethereum/dest/client.js",
		])
	})
})

// Runs right after a build, against the dist it wrote (BUILT_DIST, relative to the app).
describe.skipIf(!process.env.BUILT_DIST)("the built bundle", () => {
	it("holds no banned module", () => {
		const assets = resolve(appRoot, process.env.BUILT_DIST ?? "", "assets")
		const maps = readdirSync(assets).filter((f) => f.endsWith(".js.map"))
		expect(maps.length).toBeGreaterThan(0)
		const sources = maps.flatMap((f) => (JSON.parse(readFileSync(join(assets, f), "utf8")) as { sources: string[] }).sources)
		expect(bannedModules(sources)).toEqual([])
	})
})
