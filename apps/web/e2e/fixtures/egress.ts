/**
 * Only the run's own origins are reachable: the app, its wallet frames and its Aztec node. Every other request, another
 * run's loopback ports included, and every WebSocket is refused and recorded, and the suite asserts the record is empty
 * after every test, so a new dependency fails loudly instead of quietly reaching out. Service workers are blocked in the
 * config: routing does not see what they fetch.
 */
import type { BrowserContext } from "@playwright/test"

export interface Egress {
	/** Every refused URL the context attempted, in order. */
	readonly blocked: string[]
}

export async function confineEgress(context: BrowserContext, allowed: readonly string[]): Promise<Egress> {
	const origins = new Set(allowed.map((u) => new URL(u).origin))
	const blocked: string[] = []
	await context.route("**/*", (route) => {
		const url = new URL(route.request().url())
		if (url.protocol === "data:" || url.protocol === "blob:" || origins.has(url.origin)) return route.continue()
		blocked.push(url.href)
		return route.abort("blockedbyclient")
	})
	await context.routeWebSocket(/.*/, (ws) => {
		blocked.push(ws.url())
		return ws.close({ code: 1008, reason: "outside the run" })
	})
	return { blocked }
}
