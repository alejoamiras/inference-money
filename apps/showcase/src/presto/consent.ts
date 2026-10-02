/**
 * Presto's "Ask before you probe", adapted from the SDK README's `askBeforeConnecting` (MIT, alejoamiras/presto):
 * nothing reaches the visitor's machine until they press Connect or their browser already lets this site reach apps
 * on the device, and once the browser reports a revocation, later proofs stay in the page and any check started
 * before it is dropped. Here it also stops: "Try it yourself" holds it while mounted.
 */
import { type LoopbackPermissionState, loopbackPermission, type PrestoStatus, watchLoopbackPermission } from "@alejoamiras/presto"
import { cell, type Observable } from "@/lib/observable"
import type { PageProver } from "./prover"

/** `ask`: offer Connect. `blocked`: the visitor blocked this site, so say how to allow it. Otherwise the last check. */
export type PrestoView = "ask" | "blocked" | PrestoStatus

export interface PrestoConsent {
	/** Only from a click that first says the browser may ask to let this site reach apps on this device. */
	connect(): Promise<void>
	view: Observable<PrestoView | undefined>
	/** Every proof that starts from here on stays in the page; stopping does not cancel SDK work already under way. */
	stop(): void
}

interface Choice {
	consented: boolean
	granted: boolean
}

/** A grant consents; a denial, or a reset to "prompt" after a grant, revokes; anything else leaves the choice. */
function follow(c: Choice, state: LoopbackPermissionState): Choice {
	if (state === "granted") return { consented: true, granted: true }
	if (state === "denied" || (state === "prompt" && c.granted)) return { consented: false, granted: false }
	return c
}

export function askBeforeConnecting(page: PageProver): PrestoConsent {
	const { prover } = page
	prover.setForceLocal(true) // before the first await, so no proof goes native while this starts
	const view = cell<PrestoView | undefined>(undefined)
	let consented = false // the visitor clicked Connect, or the browser reports "granted"
	let granted = false // "granted" seen since then, so a later "prompt" means it was reset
	let epoch = 0 // bumped on revocation and on stop: a check that started earlier is dropped
	let stopped = false

	/** Follows the browser's decision. Returns true for a grant not seen before, which needs a check. */
	function apply(state: LoopbackPermissionState): boolean {
		if (stopped) return false
		const newGrant = state === "granted" && !granted
		const next = follow({ consented, granted }, state)
		if (consented && !next.consented) epoch++
		consented = next.consented
		granted = next.granted
		prover.setForceLocal(!consented)
		if (!consented) view.set(state === "denied" ? "blocked" : "ask")
		return newGrant
	}

	let lastCheck: Promise<void> = Promise.resolve()
	function check(): Promise<void> {
		if (stopped) return Promise.resolve()
		lastCheck = (async () => {
			const started = epoch
			const status = await prover.checkPrestoStatus({ forceRefresh: true }) // the browser may ask now
			if (epoch !== started) return
			const newGrant = apply(await loopbackPermission()) // records the answer given at the prompt
			if (epoch !== started || !consented) return
			if (newGrant && !status.available) return check() // granted after this probe failed
			view.set(status)
		})()
		return lastCheck
	}

	async function sync(state: LoopbackPermissionState) {
		if (!apply(state)) return
		await lastCheck // a forced check joins a probe already in flight, whose answer predates this grant
		if (consented) await check() // allowed earlier, in site settings, or in another tab
	}

	async function connect() {
		const state = await loopbackPermission() // never prompts, never contacts Presto
		if (stopped) return
		if (state === "denied") return void apply(state)
		consented = true
		granted = state === "granted"
		await check()
	}

	let unwatch: (() => void) | undefined
	void (async () => {
		const stopWatching = await watchLoopbackPermission((state) => void sync(state))
		if (stopped) return stopWatching()
		unwatch = stopWatching
		await sync(await loopbackPermission())
	})()
	// Catches a reset or a grant in browsers that report no changes.
	const unguard = page.guard(async () => sync(await loopbackPermission()))
	// A fallback may mean Presto went away: check again, so the ribbon shows it.
	const unfollow = page.proof.listen((p) => {
		if (p.attempt === "browser" && consented) void check()
	})

	return {
		connect,
		view,
		stop: () => {
			if (stopped) return
			stopped = true
			consented = granted = false
			epoch++
			prover.setForceLocal(true)
			unguard()
			unfollow()
			unwatch?.()
		},
	}
}
