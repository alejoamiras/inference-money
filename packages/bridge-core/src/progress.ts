/**
 * Wait state → a progress bar. L2->L1 exposes proven vs needed block numbers (a real "N blocks remaining"); L1->L2 has
 * no block count, so it is an elapsed/maxWait estimate capped below full until the message is actually consumable.
 */

export interface ProgressInput {
	/** L2->L1: the latest proven L2 block. */
	provenBlock?: number
	/** L2->L1: the block the message landed in; consumable once proven reaches it. */
	neededBlock?: number
	/** L2->L1: the proven block when the wait started (the fraction's baseline). */
	startBlock?: number
	elapsedMs: number
	/** Expected upper bound on the wait, for the time-based estimate. */
	maxWaitMs: number
	secondsPerBlock?: number
}

export interface BridgeProgress {
	/** 0..1, capped at {@link PROGRESS_CAP} until `done`. */
	fillFraction: number
	label: string
	/** No fraction can be estimated: render a spinner. */
	indeterminate: boolean
	blocksRemaining?: number
	done: boolean
}

export const PROGRESS_CAP = 0.95

function clamp(x: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, x))
}

function minutes(ms: number): number {
	return Math.max(0, Math.round(ms / 60_000))
}

export function computeProgress(input: ProgressInput): BridgeProgress {
	const { provenBlock, neededBlock, startBlock, elapsedMs, maxWaitMs, secondsPerBlock = 36 } = input

	if (provenBlock !== undefined && neededBlock !== undefined) {
		const blocksRemaining = Math.max(0, neededBlock - provenBlock)
		if (blocksRemaining === 0) {
			return { fillFraction: 1, label: "Ready to claim", indeterminate: false, blocksRemaining: 0, done: true }
		}
		const base = startBlock ?? provenBlock
		const span = neededBlock - base
		const fraction = span > 0 ? clamp((provenBlock - base) / span, 0, PROGRESS_CAP) : 0
		const etaMin = minutes(blocksRemaining * secondsPerBlock * 1000)
		return {
			fillFraction: fraction,
			label: `${blocksRemaining} block${blocksRemaining === 1 ? "" : "s"} remaining (~${etaMin} min)`,
			indeterminate: false,
			blocksRemaining,
			done: false,
		}
	}

	if (maxWaitMs <= 0) {
		return { fillFraction: 0, label: "Waiting for inclusion…", indeterminate: true, done: false }
	}
	const fraction = clamp(elapsedMs / maxWaitMs, 0, PROGRESS_CAP)
	const remainingMin = minutes(maxWaitMs - elapsedMs)
	return {
		fillFraction: fraction,
		label: remainingMin > 0 ? `~${remainingMin} min remaining` : "Almost there…",
		indeterminate: false,
		done: false,
	}
}
