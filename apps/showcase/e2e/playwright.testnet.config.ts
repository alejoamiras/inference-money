import { fileURLToPath } from "node:url"
import { defineConfig, devices } from "@playwright/test"

const url = process.env.SHOWCASE_URL
if (!url) throw new Error("test:testnet checks a served showcase: set SHOWCASE_URL to a Workers preview's URL, or production's")
const here = fileURLToPath(new URL(".", import.meta.url))

/**
 * The showcase exactly as served (headers, CSP, isolation), live on Sepolia and the Aztec testnet. Nothing boots here,
 * and the served CSP is the only fence: the specs fail on any violation of it.
 */
export default defineConfig({
	testDir: `${here}testnet`,
	workers: 1,
	fullyParallel: false,
	retries: 0,
	// Real proofs in the browser, then testnet blocks.
	timeout: 45 * 60_000,
	expect: { timeout: 120_000 },
	reporter: "list",
	outputDir: `${here}../test-results/testnet`,
	use: {
		...devices["Desktop Chrome"],
		baseURL: url,
		viewport: { width: 1280, height: 900 },
		trace: "retain-on-failure",
		serviceWorkers: "block",
		actionTimeout: 60_000,
		navigationTimeout: 120_000,
	},
})
