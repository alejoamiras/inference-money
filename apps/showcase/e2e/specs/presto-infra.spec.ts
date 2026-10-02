/**
 * A Presto run's own plumbing, apart from the app: the browser treats the page as a public site, so nothing it sends
 * reaches presto-server on loopback until the visitor allows it; once allowed, it reaches it over HTTPS, through a
 * certificate only this run trusts, and the proxy answers no other origin.
 */
import { readFileSync } from "node:fs"
import { request } from "node:https"
import type { Page } from "@playwright/test"
import type { PrestoRun } from "../env"
import { prestoOrigins } from "../fixtures/presto"
import { expect, test } from "../fixtures/test"

/** The loopback permission as the SDK reads it: the split name where the browser has it, else the umbrella one. */
const loopbackState = (page: Page) =>
	page.evaluate(async () => {
		const read = (name: string) => navigator.permissions.query({ name } as unknown as PermissionDescriptor)
		const status = await read("loopback-network").catch(() => read("local-network-access"))
		return status.state
	})

/** What a page fetch of `url` comes to within `ms`: the response, a refusal, or still waiting on the browser. */
const fetchFromPage = (page: Page, url: string, ms: number, body?: unknown) =>
	page.evaluate(
		async ([u, wait, json]) => {
			const init =
				json === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(json) }
			const attempt = fetch(u, init).then(
				async (res) => ({ kind: "reached", status: res.status, body: (await res.json()) as unknown }),
				(err: unknown) => ({ kind: "refused", detail: String(err) }),
			)
			const pending = new Promise<{ kind: string }>((resolve) => setTimeout(() => resolve({ kind: "pending" }), wait))
			return Promise.race([attempt, pending])
		},
		[url, ms, body] as const,
	)

/** The proxy's answer to another local process, which carries whatever Origin it likes, or none. */
const fromAnotherProcess = (p: PrestoRun, origin?: string) =>
	new Promise<number>((resolve, reject) => {
		const ca = readFileSync(`${p.tlsDir}/cert.pem`)
		const req = request({ host: "127.0.0.1", port: p.tlsPort, path: "/health", ca, headers: origin ? { origin } : {} }, (res) => {
			res.resume()
			resolve(res.statusCode ?? 0)
		})
		req.on("error", reject)
		req.end()
	})

test("until the visitor allows it, the page sends nothing to Presto, and the browser holds back what it tries", async ({
	page,
	me,
	run,
	manifest,
	presto,
}) => {
	const [https] = prestoOrigins(run.presto!)
	await page.goto("/")
	await page.waitForLoadState("networkidle")
	expect(await loopbackState(page)).toBe("prompt")
	const toPresto = (url: string) => prestoOrigins(run.presto!).includes(new URL(url).origin)
	expect(
		me.egress.allowed.filter((r) => toPresto(r.url)),
		"the page probed Presto on its own",
	).toEqual([])

	// The node is as public as the page, so only loopback waits on the permission.
	const height = { jsonrpc: "2.0", id: 1, method: "aztec_getBlockNumber", params: [] }
	expect(await fetchFromPage(page, manifest.l2.nodeUrl, 5_000, height)).toMatchObject({ kind: "reached", status: 200 })
	const outcome = await fetchFromPage(page, `${https}/health`, 5_000)
	expect(outcome.kind, JSON.stringify(outcome)).not.toBe("reached")
	expect(presto.seen, "a request reached presto-server").toEqual([])
})

test("once allowed, the page reaches presto-server over HTTPS through the run's certificate", async ({ page, context, run, presto }) => {
	const [https] = prestoOrigins(run.presto!)
	await context.grantPermissions(["local-network-access"], { origin: run.webOrigin })
	await page.goto("/")
	expect(await loopbackState(page)).toBe("granted")

	const outcome = await fetchFromPage(page, `${https}/health`, 30_000)
	expect(outcome).toMatchObject({ kind: "reached", status: 200, body: { status: "ok", api_version: 1 } })
	expect(presto.seen).toEqual([{ method: "GET", path: "/health", status: 200 }])
})

test("the proxy answers the run's origin only", async ({ run, presto }) => {
	const p = run.presto!
	expect(await fromAnotherProcess(p, "https://elsewhere.example")).toBe(403)
	expect(await fromAnotherProcess(p)).toBe(403)
	expect(await fromAnotherProcess(p, run.webOrigin)).toBe(200)
	expect(presto.seen.map((r) => r.status)).toEqual([403, 403, 200])
})
