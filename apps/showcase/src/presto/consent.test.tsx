import type { PrestoStatus } from "@alejoamiras/presto"
import { renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cell } from "@/lib/observable"
import { useLivePresto } from "@/live/useLivePresto"
import { askBeforeConnecting, type PrestoView } from "./consent"
import type { PagePresto } from "./index"
import type { PageProver } from "./prover"

const CONNECTED: PrestoStatus = { available: true, needsDownload: false, protocol: "https" }
const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

/** This site's stored decision in the browser; `report: false` changes it the way a browser that fires no event does. */
function browserDecision(initial: PermissionState) {
	let state = initial
	const listeners = new Set<() => void>()
	const status = {
		get state() {
			return state
		},
		addEventListener: (_: string, fn: () => void) => void listeners.add(fn),
		removeEventListener: (_: string, fn: () => void) => void listeners.delete(fn),
	}
	vi.stubGlobal("navigator", { permissions: { query: async () => status } })
	return {
		listeners,
		set(next: PermissionState, report = true) {
			state = next
			if (report) for (const fn of listeners) fn()
		},
	}
}

/** The page's prover, faked: each status check waits on `answer`, and `local()` is whether proofs stay in the page. */
function fakePage(answer: () => Promise<PrestoStatus> = async () => CONNECTED) {
	const forced: boolean[] = []
	let guard: (() => Promise<void>) | undefined
	const checks = vi.fn(answer)
	const page = {
		prover: { setForceLocal: (local: boolean) => void forced.push(local), checkPrestoStatus: checks },
		guard: (fn: typeof guard) => {
			guard = fn
		},
	} as unknown as PageProver
	return { page, checks, local: () => forced.at(-1), beforeProving: () => guard?.(), guarded: () => guard !== undefined }
}

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("asking before connecting Presto", () => {
	it.each<[PermissionState, PrestoView, boolean]>([
		["prompt", "ask", true],
		["denied", "blocked", true],
		["granted", CONNECTED, false],
	])(
		"on load, with the permission at %s, shows %o, and checks Presto only if the browser already allows it",
		async (state, view, local) => {
			browserDecision(state)
			const p = fakePage()
			const consent = askBeforeConnecting(p.page)
			await vi.waitFor(() => expect(consent.view.get()).toEqual(view))
			expect(p.checks).toHaveBeenCalledTimes(local ? 0 : 1)
			expect(p.local()).toBe(local)
		},
	)

	it("drops a status check that a revocation overtook: proofs stay in the page", async () => {
		const browser = browserDecision("granted")
		let answer: (status: PrestoStatus) => void = () => {}
		const p = fakePage(() => new Promise((resolve) => (answer = resolve)))
		const consent = askBeforeConnecting(p.page)
		await vi.waitFor(() => expect(p.checks).toHaveBeenCalledTimes(1))
		browser.set("denied")
		await vi.waitFor(() => expect(consent.view.get()).toBe("blocked"))
		answer(CONNECTED)
		await settled()
		expect(p.local()).toBe(true)
		expect(consent.view.get()).toBe("blocked")
	})

	it("catches a revocation the browser never reported before the next proof starts", async () => {
		const browser = browserDecision("granted")
		const p = fakePage()
		const consent = askBeforeConnecting(p.page)
		await vi.waitFor(() => expect(consent.view.get()).toEqual(CONNECTED))
		expect(p.local()).toBe(false)
		browser.set("prompt", false)
		await p.beforeProving()
		expect(p.local()).toBe(true)
		expect(consent.view.get()).toBe("ask")
	})

	it('stops when "Try it yourself" closes: later proofs stay in the page, and the browser goes unheard', async () => {
		const browser = browserDecision("granted")
		const p = fakePage()
		const presto = { proofs: { proof: cell({}) }, ask: () => askBeforeConnecting(p.page) } as unknown as PagePresto
		const { result, unmount } = renderHook(() => useLivePresto(presto))
		await vi.waitFor(() => expect(result.current?.consent.view.get()).toEqual(CONNECTED))
		expect(p.local()).toBe(false)
		unmount()
		expect(p.local()).toBe(true)
		expect(p.guarded()).toBe(false)
		expect(browser.listeners.size).toBe(0)
	})
})
