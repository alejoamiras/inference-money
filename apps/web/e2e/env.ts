/**
 * One run's coordinates, resolved by `e2e/agent.sh` and read by the config and the fixtures. Nothing boots in the
 * Playwright process: the network is `net:up`'s, the sidecar and the servers are the runner's.
 */
import { PROFILES, type TestWalletProfile } from "./test-wallet/profile"

export interface RunEnv {
	stateDir: string
	/** The run's deployment manifest, the one both builds embed. */
	manifestPath: string
	anvilUrl: string
	sidecarUrl: string
	webPort: number
	webOrigin: string
	webDist: string
	walletDist: string
	/** One loopback origin per profile. */
	walletOrigins: Record<TestWalletProfile, string>
}

function required(name: string): string {
	const v = process.env[name]
	if (!v) throw new Error(`the web e2e suite needs ${name}: run it through \`bun run test:e2e\` (e2e/agent.sh)`)
	return v
}

export function runEnv(): RunEnv {
	const webPort = Number(required("E2E_WEB_PORT"))
	const walletPort = (p: TestWalletProfile) => Number(required(`E2E_WALLET_PORT_${p.toUpperCase()}`))
	return {
		stateDir: required("E2E_STATE_DIR"),
		manifestPath: required("BRIDGE_MANIFEST"),
		anvilUrl: required("E2E_ANVIL_URL"),
		sidecarUrl: required("E2E_SIDECAR_URL"),
		webPort,
		webOrigin: `http://127.0.0.1:${webPort}`,
		webDist: required("E2E_WEB_DIST"),
		walletDist: required("E2E_WALLET_DIST"),
		walletOrigins: Object.fromEntries(PROFILES.map((p) => [p, `http://127.0.0.1:${walletPort(p)}`])) as Record<
			TestWalletProfile,
			string
		>,
	}
}

/** The iframe wallet URLs the app build lists, one per profile: the exact strings baked into its bundle. */
export const walletUrls = (env: Pick<RunEnv, "walletOrigins">): string[] => PROFILES.map((p) => `${env.walletOrigins[p]}/?profile=${p}`)
