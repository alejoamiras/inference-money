import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

// Component tests embed a fixture manifest, never a deployment: they must run on a clean checkout.
const fixture = readFileSync(fileURLToPath(new URL("./src/test/manifest.fixture.json", import.meta.url)), "utf8")

export default defineConfig({
	plugins: [react()],
	define: {
		__BRIDGE_MANIFEST__: fixture,
		__SHOWCASE_USERS_TAG__: JSON.stringify("ab".repeat(16)),
		__SHOWCASE_L1_RPC__: JSON.stringify("http://127.0.0.1:8545"),
		__SHOWCASE_PROOFS__: JSON.stringify("fake"),
	},
	resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
	test: {
		environment: "jsdom",
		include: ["src/**/*.test.{ts,tsx}", "build/**/*.test.ts", "e2e/*.test.ts"],
		setupFiles: ["./src/test/setup.ts"],
		restoreMocks: true,
	},
})
