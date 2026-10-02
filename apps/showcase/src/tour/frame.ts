import { usdc2 } from "@/ui/format"
import type { Flight } from "@/ui/Stage"
import { STAGES, type Stage, type VerdictState } from "@/ui/Verdict"
import type { PlayedScene } from "./player"
import type { Beat } from "./useTour"

export const CHECKING = "The wallet checks the rules first, by simulating the transaction."
export const NOTHING_SENT = "Nothing was proven or sent, so nothing reached a chain."

/** The stages a scene goes through: an Ethereum-only one has nothing to prove. */
export const stagesOf = (p: PlayedScene): readonly Stage[] => (p.scene.proves ? STAGES : STAGES.filter((s) => s !== "prove"))

/** The banner at each beat of a recorded scene. A refusal shows as soon as the coin moves: simulating found it. */
export function tourVerdict(p: PlayedScene, beat: Beat): VerdictState {
	if (beat === "ready") return { kind: "idle", detail: p.scene.intro(usdc2(p.amount)) }
	if (beat === "checking") return { kind: "working", stage: "simulate", detail: CHECKING }
	if (p.verdict === "refused") return { kind: "refused", rule: p.refusal ?? "", detail: `${p.scene.why} ${NOTHING_SENT}` }
	if (beat === "landed") return { kind: "settled", detail: p.scene.why }
	return p.scene.proves
		? { kind: "working", stage: "prove", detail: "The rules allow it, so the wallet proves it and sends it to Aztec." }
		: { kind: "working", stage: "send", detail: "The rules allow it, so the wallet sends it to Ethereum." }
}

export const tourFlight = (p: PlayedScene, beat: Beat): Flight => ({
	from: p.scene.from,
	to: p.scene.to,
	label: usdc2(p.amount),
	ok: p.verdict === "settled",
	phase: beat,
})
