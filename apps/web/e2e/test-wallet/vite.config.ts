/**
 * The test wallet's build, framed by the app in local e2e runs only. Its identity (node, chain, the one origin allowed
 * to frame it) comes from the run's manifest; nothing here is committed or shared between runs.
 *
 *   BRIDGE_MANIFEST=<run manifest>  WEB_ORIGIN=http://127.0.0.1:<port>  vite build|preview --config e2e/test-wallet/vite.config.ts
 */
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseManifest } from "@inference-money/bridge-core/manifest"
import { defineConfig, type Plugin } from "vite"
import { nodePolyfills } from "vite-plugin-node-polyfills"
import type { TestWalletIdentity } from "./profile.ts"

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, "../..")

function identity(): TestWalletIdentity {
	const { BRIDGE_MANIFEST: manifestPath, WEB_ORIGIN: appOrigin } = process.env
	if (!manifestPath || !appOrigin) throw new Error("the test wallet needs BRIDGE_MANIFEST and WEB_ORIGIN (the app origin that frames it)")
	const m = parseManifest(JSON.parse(readFileSync(manifestPath, "utf8")))
	if (m.network !== "local") throw new Error("the test wallet serves local networks only")
	return { nodeUrl: m.l2.nodeUrl, l1ChainId: m.l1.chainId, rollupVersion: m.l2.rollupVersion, appOrigin }
}

/** Node's resolution walk, from one package's real root to a dependency it declares. */
function depRoot(fromRoot: string, dep: string): string {
	for (let dir = fromRoot; ; dir = dirname(dir)) {
		const candidate = join(dir, "node_modules", dep)
		if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate)
		if (dirname(dir) === dir) throw new Error(`${dep} is not reachable from ${fromRoot}`)
	}
}

/**
 * The SQLite-OPFS store's worker loads `sqlite3.wasm` through emscripten's `locateFile` fallback, a bare
 * `assets/sqlite3.wasm` beside the worker chunk that no bundler rewrites, so unhashed copies are emitted there. The
 * walk follows declared dependencies (wallets → pxe → kv-store → sqlite3mc-wasm) because the isolated linker lets a
 * package see only what it declares.
 */
function sqliteWasmEmit(): Plugin {
	const pxe = depRoot(depRoot(appRoot, "@aztec/wallets"), "@aztec/pxe")
	const wasm = depRoot(depRoot(pxe, "@aztec/kv-store"), "@aztec/sqlite3mc-wasm")
	return {
		name: "test-wallet-sqlite-wasm",
		apply: "build",
		generateBundle() {
			for (const file of ["sqlite3.wasm", "sqlite3-opfs-async-proxy.js"]) {
				this.emitFile({ type: "asset", fileName: `assets/${file}`, source: readFileSync(join(wasm, "vendor/jswasm", file)) })
			}
		},
	}
}

export default defineConfig(() => {
	const id = identity()
	const csp = [
		"default-src 'self'",
		"script-src 'self' 'wasm-unsafe-eval'",
		"worker-src 'self' blob:",
		"style-src 'self' 'unsafe-inline'",
		`connect-src 'self' ${new URL(id.nodeUrl).origin} data: blob:`,
		"object-src 'none'",
		"base-uri 'self'",
		`frame-ancestors ${id.appOrigin}`,
	].join("; ")
	return {
		root: here,
		base: "/",
		build: { outDir: process.env.TEST_WALLET_OUT_DIR ?? join(here, "dist"), emptyOutDir: true, target: "esnext" },
		worker: { format: "es" as const },
		preview: {
			headers: {
				// As isolated as its embedder, so `crossOriginIsolated` (bb.js threads) holds inside the frame too, and
				// explicitly embeddable cross-origin.
				"Cross-Origin-Embedder-Policy": "require-corp",
				"Cross-Origin-Opener-Policy": "same-origin",
				"Cross-Origin-Resource-Policy": "cross-origin",
				"Content-Security-Policy": csp,
			},
		},
		define: { __TEST_WALLET__: JSON.stringify(id) },
		resolve: {
			alias: [
				{
					find: "vite-plugin-node-polyfills/shims/buffer",
					replacement: fileURLToPath(import.meta.resolve("vite-plugin-node-polyfills/shims/buffer")),
				},
				{ find: "detect-node", replacement: join(here, "detect-node.ts") },
			],
			dedupe: ["@aztec/noir-noirc_abi", "@aztec/noir-acvm_js"],
		},
		optimizeDeps: { exclude: ["@aztec/bb.js", "@aztec/noir-acvm_js", "@aztec/noir-noirc_abi"] },
		plugins: [nodePolyfills({ globals: { Buffer: true, global: true, process: true } }), sqliteWasmEmit()],
	}
})
