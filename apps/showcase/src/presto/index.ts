/** Presto on a page that proves for real; the page loads it on its own, so a fake-proof bundle carries none of it. */
import { askBeforeConnecting, type PrestoConsent } from "./consent"
import { type PageProver, pageProver } from "./prover"

export type { PrestoConsent, PrestoView } from "./consent"
export type { ProofSource, ProofState } from "./proofs"
export type { PageProver } from "./prover"

export interface PagePresto {
	proofs: PageProver
	/** Starts asking the visitor; stopping the consent keeps proofs in the page again. */
	ask(): PrestoConsent
}

export function pagePresto(ports: { port: number; httpsPort: number }): PagePresto {
	const proofs = pageProver(ports)
	return { proofs, ask: () => askBeforeConnecting(proofs) }
}
