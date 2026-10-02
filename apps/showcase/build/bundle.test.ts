// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs"
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

/** Static imports only: `import(` loads later, which is the point. */
const STATIC_IMPORT = /\bimport\s*(?:[^"'()]*?from\s*)?["']\.\/([^"']+\.js)["']/g
/**
 * What `import()` can load later. Rolldown still emits the target of an `import()` it dropped as dead code, as a chunk
 * nothing references, so what a page can run is what its entry reaches, not what `assets/` holds.
 */
const DYNAMIC_IMPORT = /\bimport\(\s*[`"']\.\/([^`"']+\.js)[`"']\s*\)/g

/** The entry and every chunk it reaches through `imports`, transitively. */
function reached(assets: string, entry: string, imports: readonly RegExp[]): string[] {
	const seen = new Set<string>()
	const visit = (chunk: string) => {
		if (seen.has(chunk)) return
		seen.add(chunk)
		const code = readFileSync(join(assets, chunk), "utf8")
		for (const re of imports) for (const m of code.matchAll(re)) if (m[1]) visit(m[1])
	}
	visit(entry)
	return [...seen]
}

/** Presto's SDK, its banner, and this app's own Presto code. */
const PRESTO = /node_modules\/@alejoamiras\/|(^|\/)src\/presto\//

/** A chunk's sources; Vite's own helpers ship without a map, and hold none. */
function sourcesOf(assets: string, chunk: string): string[] {
	const map = join(assets, `${chunk}.map`)
	return existsSync(map) ? (JSON.parse(readFileSync(map, "utf8")) as { sources: string[] }).sources : []
}

// Runs right after a build, against the dist it wrote (BUILT_DIST, relative to the app).
describe.skipIf(!process.env.BUILT_DIST)("the built bundle", () => {
	const dist = resolve(appRoot, process.env.BUILT_DIST ?? "")
	const assets = join(dist, "assets")
	const entry = () => {
		const script = readFileSync(join(dist, "index.html"), "utf8").match(/<script type="module"[^>]*src="\/assets\/([^"]+\.js)"/)?.[1]
		expect(script).toBeDefined()
		return script as string
	}

	it("holds no banned module", () => {
		const maps = readdirSync(assets).filter((f) => f.endsWith(".js.map"))
		expect(maps.length).toBeGreaterThan(0)
		expect(bannedModules(maps.flatMap((f) => sourcesOf(assets, f.replace(/\.map$/, ""))))).toEqual([])
	})

	it("plays the tour before the Aztec SDK or Presto loads: nothing the page loads first comes from them", () => {
		const eager = reached(assets, entry(), [STATIC_IMPORT]).flatMap((c) => sourcesOf(assets, c))
		expect(eager.length).toBeGreaterThan(0)
		expect(eager.filter((s) => s.includes("node_modules/@aztec-labs/") || PRESTO.test(s))).toEqual([])
	})

	it("can load Presto only when its CSP lets the page reach Presto", () => {
		const reaches = readFileSync(join(dist, "_headers"), "utf8").includes("https://127.0.0.1:")
		const loadable = reached(assets, entry(), [STATIC_IMPORT, DYNAMIC_IMPORT]).flatMap((c) => sourcesOf(assets, c))
		expect(loadable.some((s) => PRESTO.test(s))).toBe(reaches)
	})
})
