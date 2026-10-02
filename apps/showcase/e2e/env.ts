/**
 * One run's coordinates, resolved by `e2e/agent.sh`, `e2e/proving.sh` or `e2e/presto.sh` and read by the config and the
 * specs. Nothing boots in the Playwright process: the network is `net:up`'s, the sidecar, presto-server and the build
 * are the runner's.
 */
export interface RunEnv {
	stateDir: string
	/** The run's deployment manifest, the one the build embeds. */
	manifestPath: string
	anvilUrl: string
	webPort: number
	webOrigin: string
	webDist: string
	/** Set on a proving run: which of its timed runs this is (`unconstrained`, `2-cpu`). */
	proving: string | undefined
	/** Set on a Presto run: presto-server's HTTP port, its HTTPS proxy's port, and the proxy's certificate dir. */
	presto: PrestoRun | undefined
}

export interface PrestoRun {
	port: number
	tlsPort: number
	tlsDir: string
}

function required(name: string): string {
	const v = process.env[name]
	if (!v)
		throw new Error(
			`the showcase's browser runs need ${name}: run them through \`bun run test:e2e\`, \`test:e2e:presto\` or \`test:proving\``,
		)
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
		proving: process.env.E2E_PROVING || undefined,
		presto: process.env.E2E_PRESTO_PORT
			? {
					port: Number(required("E2E_PRESTO_PORT")),
					tlsPort: Number(required("E2E_PRESTO_TLS_PORT")),
					tlsDir: required("E2E_PRESTO_TLS_DIR"),
				}
			: undefined,
	}
}
