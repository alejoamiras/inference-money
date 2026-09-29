import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
import { nodePolyfills } from "vite-plugin-node-polyfills"
import { type BuildTarget, EMBEDDED_MANIFEST, headersFile, ISOLATION_HEADERS, resolveTarget, servedHeaders } from "./build/target.ts"

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url))

/** `_headers` for Workers static assets, and the exact manifest string the bundle embeds, for the identity check. */
function outputsPlugin(target: BuildTarget, embedded: string): Plugin {
	let outDir = "dist"
	return {
		name: "usdc-bridge-outputs",
		apply: "build",
		configResolved(config) {
			outDir = resolve(config.root, config.build.outDir)
		},
		closeBundle() {
			writeFileSync(resolve(outDir, "_headers"), headersFile(target))
			writeFileSync(resolve(outDir, EMBEDDED_MANIFEST), embedded)
		},
	}
}

export default defineConfig(() => {
	const target = resolveTarget(process.env, REPO_ROOT)
	const devPort = Number(process.env.WEB_DEV_PORT) || 5180
	const embedded = JSON.stringify(target.manifest)
	return {
		define: {
			__BRIDGE_MANIFEST__: embedded,
			__WEB_WALLET_URLS__: JSON.stringify(target.webWalletUrls),
		},
		resolve: {
			alias: [
				{ find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
				// The Buffer global injects this import into every module, workspace packages included, which the
				// isolated linker cannot resolve from their own location: pin it to this app's copy.
				{
					find: "vite-plugin-node-polyfills/shims/buffer",
					replacement: fileURLToPath(import.meta.resolve("vite-plugin-node-polyfills/shims/buffer")),
				},
			],
			// Two copies of a wasm binding package split init from use, and the wasm instance never resolves.
			dedupe: ["@aztec/noir-noirc_abi", "@aztec/noir-acvm_js"],
		},
		plugins: [
			react(),
			tailwindcss(),
			// Aztec packages read `process`/`Buffer` at module top level.
			nodePolyfills({ globals: { Buffer: true, global: true, process: true } }),
			outputsPlugin(target, embedded),
		],
		// Dev keeps the inline HMR preamble, so it gets isolation only; preview serves exactly what production does.
		server: { port: devPort, strictPort: !process.env.WEB_DEV_PORT, headers: ISOLATION_HEADERS },
		preview: { headers: servedHeaders(target) },
		build: { target: "es2023", sourcemap: true },
	}
})
