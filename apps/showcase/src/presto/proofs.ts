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
	/** The prover's phase callback. */
	onPhase(phase: PrestoPhase): void
	/** `prove` as one proof: after the guard, then attributed once it settles. */
	around<T>(prove: () => Promise<T>): Promise<T>
	/** Runs before each proof while set: the visitor's consent re-reading the browser's decision. */
	guard(check: (() => Promise<void>) | undefined): void
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
