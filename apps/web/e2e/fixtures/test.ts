/**
 * The suite's `test`: every test gets a context with the L1 shim, the egress fence and the parked wallet panel; every
 * spec file gets a worker with its own actor pool.
 *
 * Actors are created in Node before any wallet frame exists and reach the wallet origins, and only them, through a
 * context init script: the SDK creates the session iframe inside `establishSecureChannel`, so no page script could run
 * early enough. The wallet imports every seed before it answers the grant.
 */
import { type BrowserContext, test as base, expect, type Page } from "@playwright/test"
import type { Hex } from "viem"
import { type RunEnv, runEnv } from "../env"
import type { Seed } from "../test-wallet/profile"
import { type Actor, newActors, newL1Key } from "./actors"
import { mintUsdc, type RunManifest, readRunManifest } from "./chain"
import { confineEgress, type Egress } from "./egress"
import { installL1Wallet, type L1WalletControl } from "./l1-wallet"
import { parkWalletPanel } from "./wallet-panel"

/** The app lists at most 16 granted accounts; a file whose tests need more is split. */
export const MAX_POOL = 16
const SPARES = 1
/** Every worker's Ethereum account starts with this much USDC. */
export const L1_USDC = 1_000n * 10n ** 6n

export interface ActorPool {
	readonly all: readonly Actor[]
	/** The next unused actor: a retry takes a spare, never one an earlier attempt touched. */
	take(): Actor
}

interface Fixtures {
	l1: L1WalletControl
	egress: Egress
	page: Page
}

interface WorkerFixtures {
	/** Actors the file's tests consume, declared with `test.use({ cells: n })`. */
	cells: number
	/** The file's actors can pay their own public txs (Fee Juice), as a wallet does when the app names no sponsor. */
	feeJuice: boolean
	run: RunEnv
	manifest: RunManifest
	pool: ActorPool
	/** A fresh Ethereum key with gas money and {@link L1_USDC}. */
	l1Key: Hex
}

export const test = base.extend<Fixtures, WorkerFixtures>({
	cells: [1, { option: true, scope: "worker" }],
	feeJuice: [false, { option: true, scope: "worker" }],

	// biome-ignore lint/correctness/noEmptyPattern: Playwright requires the destructuring form even with no dependencies.
	run: [async ({}, use) => use(runEnv()), { scope: "worker" }],

	manifest: [async ({ run }, use) => use(readRunManifest(run.manifestPath)), { scope: "worker" }],

	pool: [
		async ({ run, cells, feeJuice }, use) => {
			const n = cells + SPARES
			if (n > MAX_POOL) throw new Error(`${cells} cells need ${n} actors, above the grant cap of ${MAX_POOL}: split the file`)
			const all = await newActors(run.sidecarUrl, n, feeJuice)
			let next = 0
			await use({
				all,
				take() {
					const a = all[next++]
					if (!a) throw new Error("the file's actor pool is exhausted (cells + spares)")
					return a
				},
			})
		},
		{ scope: "worker" },
	],

	l1Key: [
		async ({ run, manifest }, use) => {
			const key = await newL1Key(run.anvilUrl)
			await mintUsdc(run.anvilUrl, manifest, key, L1_USDC)
			await use(key)
		},
		{ scope: "worker" },
	],

	context: async ({ context, run, pool, l1Key }, use) => {
		const walletOrigins = Object.values(run.walletOrigins)
		await installSeeds(
			context,
			walletOrigins,
			pool.all.map((a) => a.seed),
		)
		await parkWalletPanel(context, walletOrigins)
		controls.set(context, await installL1Wallet(context, { rpcUrl: run.anvilUrl, privateKey: l1Key, chainId: 31337 }))
		await use(context)
	},

	l1: async ({ context }, use) => {
		const control = controls.get(context)
		if (!control) throw new Error("the L1 wallet is installed by the context fixture")
		await use(control)
	},

	egress: [
		async ({ context, run, manifest }, use) => {
			const egress = await confineEgress(context, [run.webOrigin, ...Object.values(run.walletOrigins), manifest.l2.nodeUrl])
			await use(egress)
			expect(egress.blocked, "every request stayed inside the run").toEqual([])
		},
		{ auto: true },
	],

	// Both frames' errors land in the runner's output, so a failure reads from the log alone.
	page: async ({ page }, use) => {
		page.on("console", (msg) => {
			const text = msg.text()
			if (text.startsWith("[test-wallet") || msg.type() === "error") console.log(`[page] ${text.slice(0, 300)}`)
		})
		page.on("pageerror", (err) => console.log(`[pageerror] ${err.message.slice(0, 300)}`))
		await use(page)
	},
})

export { expect }

const controls = new WeakMap<BrowserContext, L1WalletControl>()

async function installSeeds(context: BrowserContext, walletOrigins: string[], seeds: Seed[]): Promise<void> {
	await context.addInitScript(
		([origins, list]) => {
			if (origins.includes(location.origin)) window.__testWalletSeeds = list
		},
		[walletOrigins, seeds] as const,
	)
}
