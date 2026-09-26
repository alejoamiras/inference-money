/**
 * The run's L2 hands, in Bun (the deployer and local-network packages are Bun-only; the Playwright runner is Node):
 * it deploys actor accounts on request and keeps the local network building blocks for its whole life.
 *
 *   RUN_ID=<run>  SIDECAR_PORT=<port>  bun e2e/run/sidecar.ts
 *
 * POST /actors {"count": n} → {"actors": [{secret, signingKey, address}]}; GET /health → 200 once ready.
 */
import { Fr } from "@aztec/aztec.js/fields"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import type { EmbeddedWallet } from "@aztec/wallets/embedded"
import { type BridgeManifest, registerBridgeContracts, registerSponsor } from "@inference-money/bridge-core"
import {
	enterOwnedTmpDir,
	localManifestPath,
	newSponsoredAccount,
	openBridgeWallet,
	readManifest,
	signingKeyFor,
	startBlockHeartbeat,
} from "@inference-money/deployer"
import { resolveEndpoints, runIdFor } from "@inference-money/local-network"

const MAX_ACTORS_PER_REQUEST = 16

async function openWallet(nodeUrl: string, m: BridgeManifest): Promise<EmbeddedWallet> {
	const wallet = await openBridgeWallet(createAztecNodeClient(nodeUrl), { prove: false })
	await registerSponsor(wallet, m)
	await registerBridgeContracts(wallet, m)
	return wallet
}

/** Account deploys share one wallet, whose nonces and PXE state are not safe to drive concurrently. */
function serialized<T>(): (run: () => Promise<T>) => Promise<T> {
	let tail: Promise<unknown> = Promise.resolve()
	return (run) => {
		const next = tail.then(run)
		tail = next.catch(() => {})
		return next
	}
}

async function newActor(wallet: EmbeddedWallet, m: BridgeManifest) {
	const secret = Fr.random()
	const address = await newSponsoredAccount(wallet, m, secret)
	return { secret: secret.toString(), signingKey: signingKeyFor(secret).toString(), address: address.toString() }
}

async function main(): Promise<void> {
	const runId = runIdFor()
	const port = Number(process.env.SIDECAR_PORT)
	if (!Number.isInteger(port) || port <= 0) throw new Error("SIDECAR_PORT must name the port this run claimed")
	const m = readManifest(localManifestPath(runId))
	const { nodeUrl } = resolveEndpoints(runId)
	const exitTmp = enterOwnedTmpDir()
	const wallet = await openWallet(nodeUrl, m)
	const beatWallet = await openWallet(nodeUrl, m)
	const stopBeat = await startBlockHeartbeat(beatWallet, m)
	const queue = serialized<unknown>()

	const server = Bun.serve({
		hostname: "127.0.0.1",
		port,
		async fetch(req) {
			const { pathname } = new URL(req.url)
			if (req.method === "GET" && pathname === "/health") return Response.json({ ok: true })
			if (req.method !== "POST" || pathname !== "/actors") return new Response("not found", { status: 404 })
			const { count } = (await req.json()) as { count?: unknown }
			if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > MAX_ACTORS_PER_REQUEST) {
				return new Response(`count must be 1..${MAX_ACTORS_PER_REQUEST}`, { status: 400 })
			}
			const actors = []
			for (let i = 0; i < (count as number); i++) actors.push(await queue(() => newActor(wallet, m)))
			return Response.json({ actors })
		},
		error: (e) => new Response(e instanceof Error ? e.message : String(e), { status: 500 }),
	})
	console.log(`[sidecar] ${runId} ready on ${server.url}`)

	const shutdown = async () => {
		server.stop(true)
		await stopBeat().catch(() => {})
		await Promise.allSettled([wallet.stop(), beatWallet.stop()])
		exitTmp()
		process.exit(0)
	}
	process.once("SIGTERM", shutdown)
	process.once("SIGINT", shutdown)
}

await main()
