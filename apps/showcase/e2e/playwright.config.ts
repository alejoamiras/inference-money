import { fileURLToPath } from "node:url"
import { defineConfig, devices } from "@playwright/test"
import { runEnv } from "./env"

const env = runEnv()
const here = fileURLToPath(new URL(".", import.meta.url))
const appRoot = fileURLToPath(new URL("..", import.meta.url))
const vite = `${appRoot}node_modules/.bin/vite`

/**
 * One local network, one browser, one worker: each test a fresh context, and parallelism is `--shard` across separate
 * runs (each its own network). A proving run is its own project, which the suite never runs.
 */
export default defineConfig({
	testDir: `${here}specs`,
	workers: 1,
	fullyParallel: false,
	retries: env.proving ? 0 : Number(process.env.E2E_RETRIES ?? 0),
	timeout: 10 * 60_000,
	expect: { timeout: 60_000 },
	reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: `${env.stateDir}/playwright-report` }]] : "list",
	outputDir: `${env.stateDir}/test-results`,
	use: {
		...devices["Desktop Chrome"],
		baseURL: env.webOrigin,
		viewport: { width: 1280, height: 900 },
		trace: "retain-on-failure",
		// Routing does not see a service worker's requests, so none may run.
		serviceWorkers: "block",
		actionTimeout: 60_000,
		navigationTimeout: 60_000,
	},
	projects: env.proving
		? // The full browser, not the headless shell, which lacks `performance.measureUserAgentSpecificMemory`.
			[{ name: "proving", testMatch: /proving\.spec\.ts$/, use: { channel: "chromium" } }]
		: [{ name: "showcase", testIgnore: /proving\.spec\.ts$/ }],
	webServer: {
		// The production build, served with the exact headers production serves.
		command: `${vite} preview --outDir ${env.webDist} --host 127.0.0.1 --port ${env.webPort} --strictPort`,
		cwd: appRoot,
		url: `${env.webOrigin}/`,
		reuseExistingServer: false,
		timeout: 60_000,
		env: { BRIDGE_MANIFEST: env.manifestPath, SHOWCASE_PROOFS: env.proving ? "real" : "fake" },
	},
})
