import { fileURLToPath } from "node:url"
import { defineConfig, devices, type Project } from "@playwright/test"
import { type RunEnv, runEnv } from "./env"
import { readRunManifest } from "./fixtures/chain"
import { spkiPin } from "./fixtures/presto"

const env = runEnv()
const here = fileURLToPath(new URL(".", import.meta.url))
const appRoot = fileURLToPath(new URL("..", import.meta.url))
const vite = `${appRoot}node_modules/.bin/vite`

const PROVING = /proving\.spec\.ts$/
const PRESTO = /presto[^/]*\.spec\.ts$/

/**
 * Production's address spaces: the page, its Aztec node and its Ethereum RPC are public, so Presto is the only thing on
 * loopback, which the browser lets the page reach only with the visitor's permission.
 */
const servedAddressSpaces = (env: RunEnv): string =>
	[env.webOrigin, readRunManifest(env.manifestPath).l2.nodeUrl, env.anvilUrl].map((u) => `${new URL(u).host}=public`).join(",")

/** A run's one project. A Presto run's browser trusts the run's certificate alone. */
function projectsFor(env: RunEnv): Project[] {
	if (env.proving) {
		// The full browser, not the headless shell, which lacks `performance.measureUserAgentSpecificMemory`.
		return [{ name: "proving", testMatch: PROVING, use: { channel: "chromium" } }]
	}
	if (env.presto) {
		const args = [
			`--ignore-certificate-errors-spki-list=${spkiPin(env.presto.tlsDir)}`,
			`--ip-address-space-overrides=${servedAddressSpaces(env)}`,
		]
		return [{ name: "presto", testMatch: PRESTO, use: { launchOptions: { args } } }]
	}
	return [{ name: "showcase", testIgnore: [PROVING, PRESTO] }]
}

/** The preview serves the build's own headers, so it needs the build's proof mode and Presto ports. */
function previewEnv(env: RunEnv): Record<string, string> {
	const proofs = env.proving || env.presto ? "real" : "fake"
	const presto: Record<string, string> = env.presto
		? { PRESTO_PORT: String(env.presto.port), PRESTO_HTTPS_PORT: String(env.presto.tlsPort) }
		: {}
	return { BRIDGE_MANIFEST: env.manifestPath, SHOWCASE_PROOFS: proofs, ...presto }
}

/**
 * One local network, one browser, one worker: each test a fresh context, and parallelism is `--shard` across separate
 * runs (each its own network). A proving or Presto run is its own project, which the suite never runs.
 */
export default defineConfig({
	testDir: `${here}specs`,
	workers: 1,
	fullyParallel: false,
	retries: env.proving || env.presto ? 0 : Number(process.env.E2E_RETRIES ?? 0),
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
	projects: projectsFor(env),
	webServer: {
		// The production build, served with the exact headers production serves.
		command: `${vite} preview --outDir ${env.webDist} --host 127.0.0.1 --port ${env.webPort} --strictPort`,
		cwd: appRoot,
		url: `${env.webOrigin}/`,
		reuseExistingServer: false,
		timeout: 60_000,
		env: previewEnv(env),
	},
})
