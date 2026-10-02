import { PrestoProver } from "@alejoamiras/presto"
import { type CircuitSimulator, WASMSimulator } from "@aztec-labs/simulator/client"
import { type ProofTracker, proofTracker } from "./proofs"

/** The page's one prover, which the PXE proves through on every route. */
export interface PageProver extends Omit<ProofTracker, "onPhase"> {
	prover: PrestoProver
	/** Shared with the PXE, as its default prover shares its own. */
	simulator: CircuitSimulator
}

/** Proves in the page until a consent turns Presto on. */
export function pageProver(presto: { port: number; httpsPort: number }): PageProver {
	const { onPhase, ...tracker } = proofTracker()
	const simulator = new WASMSimulator()
	const prover = new PrestoProver({ simulator, presto, onPhase })
	prover.setForceLocal(true)
	return { prover, simulator, ...tracker }
}
