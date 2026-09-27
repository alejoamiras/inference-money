import { fileURLToPath } from "node:url"
import { defineConfig, devices } from "@playwright/test"
import { runEnv, walletUrls } from "./env"
import { PROFILES } from "./test-wallet/profile"

const env = runEnv()
const here = fileURLToPath(new URL(".", import.meta.url))
const appRoot = fileURLToPath(new URL("..", import.meta.url))
const vite = `${appRoot}node_modules/.bin/vite`

/**
 * One local network, one browser, one worker: each spec file owns an actor pool, each test a fresh context, and
 * parallelism is `--shard` across separate runs (each its own network).
 */
export default defineConfig({
	testDir: `${here}specs`,
	workers: 1,
	fullyParallel: false,
	retries: Number(process.env.E2E_RETRIES ?? 0),
	timeout: 10 * 60_000,
	expect: { timeout: 60_000 },
	reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: `${env.stateDir}/playwright-report` }]] : "list",
	outputDir: `${env.stateDir}/test-results`,
	use: {
		...devices["Desktop Chrome"],
		baseURL: env.webOrigin,
		viewport: { width: 1280, height: 900 },
		trace: "retain-on-failure",
		actionTimeout: 60_000,
		navigationTimeout: 60_000,
	},
	// The expiry spec moves L1 time past a permit deadline; its project runs after everything else, never beside it.
	projects: [
		{ name: "bridge", testIgnore: /expiry\.spec\.ts$/ },
		{ name: "expiry", testMatch: /expiry\.spec\.ts$/, dependencies: ["bridge"] },
	],
	webServer: [
		{
			// The production build, served with the exact headers production serves.
			command: `${vite} preview --outDir ${env.webDist} --host 127.0.0.1 --port ${env.webPort} --strictPort`,
			cwd: appRoot,
			url: `${env.webOrigin}/`,
			reuseExistingServer: false,
			timeout: 60_000,
			env: { BRIDGE_MANIFEST: env.manifestPath, WEB_WALLET_URLS: walletUrls(env).join(",") },
		},
		// One wallet build, served once per profile so each has its own origin.
		...PROFILES.map((profile) => ({
			command: `${vite} preview --config e2e/test-wallet/vite.config.ts --outDir ${env.walletDist} --host 127.0.0.1 --port ${new URL(env.walletOrigins[profile]).port} --strictPort`,
			cwd: appRoot,
			url: `${env.walletOrigins[profile]}/`,
			reuseExistingServer: false,
			timeout: 60_000,
			env: { BRIDGE_MANIFEST: env.manifestPath, WEB_ORIGIN: env.webOrigin },
		})),
	],
})
