/**
 * One run's coordinates, resolved by `e2e/agent.sh` or `e2e/proving.sh` and read by the config and the specs. Nothing
 * boots in the Playwright process: the network is `net:up`'s, the sidecar and the build are the runner's.
 */
export interface RunEnv {
	stateDir: string
	/** The run's deployment manifest, the one the build embeds. */
	manifestPath: string
	anvilUrl: string
	webPort: number
	webOrigin: string
	webDist: string
	/** The suite's sidecar; a proving run has none. */
	sidecarUrl: string | undefined
	/** Set on a proving run: which of its timed runs this is (`unconstrained`, `2-cpu`). */
	proving: string | undefined
}

function required(name: string): string {
	const v = process.env[name]
	if (!v) throw new Error(`the showcase's browser runs need ${name}: run them through \`bun run test:e2e\` or \`test:proving\``)
	return v
}

export function runEnv(): RunEnv {
	const webPort = Number(required("E2E_WEB_PORT"))
	return {
		stateDir: required("E2E_STATE_DIR"),
		manifestPath: required("BRIDGE_MANIFEST"),
		anvilUrl: required("E2E_ANVIL_URL"),
		webPort,
		webOrigin: `http://127.0.0.1:${webPort}`,
		webDist: required("E2E_WEB_DIST"),
		sidecarUrl: process.env.E2E_SIDECAR_URL || undefined,
		proving: process.env.E2E_PROVING || undefined,
	}
}
