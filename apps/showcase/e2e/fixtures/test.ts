/**
 * The suite's `test`. A visitor is a browser context, so it has wallet stores of its own, as a second person on the page
 * would: confined to the run's origins (the app, the Aztec node, anvil), every JSON-RPC call it makes recorded, and its
 * page's errors in the runner's output. `page` is the test's own visitor's.
 */
import { type BrowserContext, test as base, expect, type Page } from "@playwright/test"
import { type RunEnv, runEnv } from "../env"
import { type RunManifest, readRunManifest } from "./chain"
import { confineEgress, type Egress } from "./egress"
import { type RpcLog, recordRpc } from "./rpc"

export interface Visitor {
	context: BrowserContext
	page: Page
	rpc: RpcLog
	egress: Egress
}

interface Fixtures {
	me: Visitor
	/** Opens another visitor, closed with the test. */
	another: () => Promise<Visitor>
}

interface WorkerFixtures {
	run: RunEnv
	manifest: RunManifest
}

async function visit(context: BrowserContext, run: RunEnv, m: RunManifest): Promise<Visitor> {
	const egress = await confineEgress(context, [run.webOrigin, m.l2.nodeUrl, run.anvilUrl])
	const rpc = await recordRpc(context, [m.l2.nodeUrl, run.anvilUrl])
	const page = await context.newPage()
	page.on("console", (msg) => {
		if (msg.type() === "error") console.log(`[page] ${msg.text().slice(0, 300)}`)
	})
	page.on("pageerror", (err) => console.log(`[pageerror] ${err.message.slice(0, 300)}`))
	return { context, page, rpc, egress }
}

const leftNothing = (v: Visitor) => expect(v.egress.blocked, "every request stayed inside the run").toEqual([])

export const test = base.extend<Fixtures & { page: Page }, WorkerFixtures>({
	// biome-ignore lint/correctness/noEmptyPattern: Playwright requires the destructuring form even with no dependencies.
	run: [async ({}, use) => use(runEnv()), { scope: "worker" }],
	manifest: [async ({ run }, use) => use(readRunManifest(run.manifestPath)), { scope: "worker" }],

	me: async ({ context, run, manifest }, use) => {
		const v = await visit(context, run, manifest)
		await use(v)
		leftNothing(v)
	},
	page: async ({ me }, use) => use(me.page),

	another: async ({ browser, run, manifest }, use, testInfo) => {
		const opened: Visitor[] = []
		const { viewport, serviceWorkers } = testInfo.project.use
		await use(async () => {
			const v = await visit(await browser.newContext({ baseURL: run.webOrigin, viewport, serviceWorkers }), run, manifest)
			opened.push(v)
			return v
		})
		for (const v of opened) {
			await v.context.close()
			leftNothing(v)
		}
	},
})

export { expect }
