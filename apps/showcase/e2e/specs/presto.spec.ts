/**
 * "Try it yourself" with a Presto on the visitor's machine: the run's presto-server behind the HTTPS proxy. Nothing
 * reaches it before the visitor connects; a send then proves there; once the browser revokes the permission, or
 * Presto stops answering over HTTPS, proofs run in the page and no witness leaves it over HTTP.
 */
import type { Page } from "@playwright/test"
import { TESTIDS } from "../../src/lib/testids"
import { prestoOrigins } from "../fixtures/presto"
import { expect, test } from "../fixtures/test"
import { compose, openLive, tryIt } from "../pages/live"

// Two of the three sends prove in the page, with real proofs.
test.describe.configure({ timeout: 40 * 60_000 })

const SEND = { actor: "alice", action: "send", to: "galactica", amount: "0.01" }

const ribbon = (page: Page) => page.getByTestId(TESTIDS.prestoRibbon)
const hint = (page: Page) => page.getByTestId(TESTIDS.walletStatus)
const proveChip = (page: Page) => page.getByTestId(TESTIDS.verdict).locator('[data-stage="prove"]')

/** A send that settles, and what the Prove chip then says. */
async function send(page: Page): Promise<string | null> {
	const run = await tryIt(page)
	expect(run.kind, run.detail).toBe("settled")
	return proveChip(page).textContent()
}

/** The face the ribbon's text asks for, and whether the page can load it: from this origin, under the CSP. */
const ribbonFace = (page: Page) =>
	ribbon(page).evaluate(async (el) => {
		const text = el.shadowRoot?.querySelector(".ribbon")
		const loaded = await document.fonts.load('16px "Figtree Variable"')
		return { family: text ? getComputedStyle(text).fontFamily : "", loaded: loaded.map((f) => f.status) }
	})

test("proves on Presto only once the visitor connects it, and in the page once it is revoked or gone", async ({
	page,
	me,
	context,
	run,
	presto,
}) => {
	const [https, http] = prestoOrigins(run.presto!)
	const toPresto = () => me.egress.allowed.filter((r) => r.url.startsWith(https) || r.url.startsWith(http))
	const grant = () => context.grantPermissions(["local-network-access"], { origin: run.webOrigin })

	await test.step("loading the page reaches nothing on the visitor's machine", async () => {
		await openLive(page)
		await expect(ribbon(page)).toHaveAttribute("state", "connect")
		expect(toPresto()).toEqual([])
		const face = await ribbonFace(page)
		expect(face.family).toMatch(/^"?Figtree Variable"?,/)
		expect(face.loaded).toContain("loaded")
	})

	await test.step("Connect, then the browser's grant, connects Presto", async () => {
		await ribbon(page).locator('[data-action="connect"]').click()
		await grant()
		await expect(ribbon(page)).toHaveAttribute("state", /^(available|downloading)$/)
		expect(presto.seen.filter((r) => r.status !== 200)).toEqual([])
	})

	await test.step("a send proves on Presto", async () => {
		await compose(page, SEND)
		expect(await send(page)).toBe("Prove · Presto")
		expect(presto.seen.filter((r) => r.path === "/prove")).toEqual([{ method: "POST", path: "/prove", status: 200 }])
	})

	await test.step("after the browser revokes it, a send proves in the page and nothing reaches Presto", async () => {
		await context.clearPermissions()
		const reached = toPresto().length
		expect(await send(page)).toBe("Prove")
		expect(toPresto()).toHaveLength(reached)
		await expect(hint(page)).toContainText("proven in this browser.")
	})

	await test.step("with Presto gone from HTTPS, a send proves in the page, and HTTP carries no witness", async () => {
		await grant()
		await expect(ribbon(page)).toHaveAttribute("state", "available")
		await expect(ribbon(page)).toBeHidden()
		await presto.stop()
		const reached = toPresto().length
		expect(await send(page)).toBe("Prove")
		await expect(ribbon(page)).toHaveAttribute("state", "secure-connection-unavailable")
		await expect(hint(page)).toContainText("proven by Presto when it can, else in this browser.")
		const overHttp = toPresto()
			.slice(reached)
			.filter((r) => r.url.startsWith(http))
		expect(
			overHttp.every((r) => r.method === "GET" && new URL(r.url).pathname === "/health"),
			JSON.stringify(overHttp),
		).toBe(true)
	})
})
