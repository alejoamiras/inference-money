import type { PrestoPhase } from "@alejoamiras/presto"
import { cell, type Observable } from "@/lib/observable"

/** Where a proof ran: in this page, or natively on the visitor's machine, through Presto. */
export type ProofSource = "browser" | "presto"

/**
 * The proof in flight, or the last one, as the SDK reported it: `attempt` is where it is going (Presto once sent
 * there, the browser once it fell back, unset before either), `ran` where it finished. Presto is never `ran` for a
 * proof that did not finish there.
 */
export interface ProofState {
	attempt?: ProofSource
	ran?: ProofSource
}

export interface ProofTracker {
	proof: Observable<ProofState>
	onPhase(phase: PrestoPhase): void
	/**
	 * `prove` as one proof: after the guard, then attributed once it settles. Calls must not overlap, since one cell holds
	 * the proof in flight; the page's sends run one at a time (`DemoWallet.exclusive`).
	 */
	around<T>(prove: () => Promise<T>): Promise<T>
	/** Runs `check` before each proof until the returned function removes it, unless another check replaced it since. */
	guard(check: () => Promise<void>): () => void
}

export function proofTracker(): ProofTracker {
	const proof = cell<ProofState>({})
	let check: (() => Promise<void>) | undefined
	return {
		proof,
		onPhase: (phase) => {
			if (phase === "transmit") proof.set({ attempt: "presto" })
			else if (phase === "fallback") proof.set({ attempt: "browser" })
		},
		guard: (fn) => {
			check = fn
			return () => {
				if (check === fn) check = undefined
			}
		},
		async around(prove) {
			proof.set({})
			try {
				await check?.()
				const result = await prove()
				// The SDK reports `proved` before it decodes Presto's answer, and falls back after a bad one: only the
				// settled call is final.
				proof.set({ ran: proof.get().attempt ?? "browser" })
				return result
			} catch (e) {
				proof.set({})
				throw e
			}
		},
	}
}
