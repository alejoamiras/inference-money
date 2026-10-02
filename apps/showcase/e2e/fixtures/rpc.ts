/**
 * Every JSON-RPC call a context makes to the run's Aztec node and anvil, read off the requests themselves, so a spec
 * proves what the page sent (or never sent) without trusting the page. Registered after the egress fence, so it sees
 * each request first and passes it on. The node's client batches calls, so one request may carry several.
 */
import type { BrowserContext, Route } from "@playwright/test"

export interface RpcLog {
	/** Every method called so far, in order; a spec marks a point with `calls.length`. */
	readonly calls: readonly string[]
	/** How many calls to `method` were made since `mark`. */
	countSince(mark: number, method: string): number
	/**
	 * Holds the next request that calls `method`; `held` resolves once one is caught. `release` passes it on, or aborts
	 * it so it never reaches the chain (a request whose page has gone cannot be passed on).
	 */
	holdNext(method: string): { held: Promise<void>; release: (how?: "continue" | "abort") => void }
}

/** The methods L1 txs leave the page by: the demo wallets sign locally, so a raw tx is what anvil receives. */
export const L1_SENDS = ["eth_sendRawTransaction", "eth_sendTransaction"] as const
/** aztec.js namespaces the node's methods `aztec_`; a spec that expects a send counts it, so a rename fails loudly. */
export const L2_SEND = "aztec_sendTx"

function methodsOf(body: string | null): string[] {
	if (!body) return []
	try {
		const parsed: unknown = JSON.parse(body)
		return (Array.isArray(parsed) ? parsed : [parsed]).flatMap((c: { method?: unknown }) =>
			typeof c?.method === "string" ? [c.method] : [],
		)
	} catch {
		return []
	}
}

export async function recordRpc(context: BrowserContext, endpoints: readonly string[]): Promise<RpcLog> {
	const origins = new Set(endpoints.map((u) => new URL(u).origin))
	const calls: string[] = []
	type Release = "continue" | "abort"
	let hold: { method: string; caught: () => void; gate: Promise<Release> } | undefined
	await context.route(
		(url) => origins.has(url.origin),
		async (route: Route) => {
			const methods = methodsOf(route.request().postData())
			calls.push(...methods)
			const h = hold
			if (!h || !methods.includes(h.method)) return route.fallback()
			hold = undefined
			h.caught()
			if ((await h.gate) === "abort") return route.abort("failed").catch(() => {})
			return route.fallback()
		},
	)
	return {
		calls,
		countSince: (mark, method) => calls.slice(mark).filter((m) => m === method).length,
		holdNext(method) {
			let caught = () => {}
			let release: (how?: Release) => void = () => {}
			const held = new Promise<void>((r) => {
				caught = r
			})
			const gate = new Promise<Release>((r) => {
				release = (how = "continue") => r(how)
			})
			hold = { method, caught, gate }
			return { held, release }
		},
	}
}
