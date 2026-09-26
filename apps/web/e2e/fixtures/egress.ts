/**
 * Nothing leaves the machine: every non-loopback request is aborted and recorded, and the suite asserts the record is
 * empty after every test, so a new remote dependency fails loudly instead of quietly phoning out.
 */
import type { BrowserContext } from "@playwright/test"

export interface Egress {
	/** Every non-loopback URL the context attempted, in order. */
	readonly blocked: string[]
}

const isLoopback = (host: string) => host === "127.0.0.1" || host === "localhost" || host === "[::1]"

export async function confineEgress(context: BrowserContext): Promise<Egress> {
	const blocked: string[] = []
	await context.route("**/*", (route) => {
		const url = new URL(route.request().url())
		if (url.protocol === "data:" || url.protocol === "blob:" || isLoopback(url.hostname)) return route.continue()
		blocked.push(url.href)
		return route.abort("blockedbyclient")
	})
	return { blocked }
}
