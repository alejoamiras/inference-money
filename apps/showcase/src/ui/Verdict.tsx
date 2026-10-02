import { tv } from "tailwind-variants"
import { TESTIDS } from "@/lib/testids"

export const STAGES = ["simulate", "prove", "send", "settle"] as const
export type Stage = (typeof STAGES)[number]

/** Where an action stands. A refusal is the contracts' own, found while simulating; a failure is anything else. */
export type VerdictState =
	| { kind: "idle"; detail: string }
	| { kind: "working"; stage: Stage; detail: string }
	| { kind: "settled"; detail: string }
	| { kind: "refused"; rule: string; detail: string }
	| { kind: "failed"; stage: Stage; detail: string }

type ChipState = "todo" | "active" | "done" | "failed"

const LABEL: Record<Stage, string> = { simulate: "Simulate", prove: "Prove", send: "Send", settle: "Settle" }
const WORKING_TITLE: Record<Stage, string> = {
	simulate: "Checking the rules",
	prove: "Proving in this browser",
	send: "Sending",
	settle: "Waiting for the chain",
}

function chipState(v: VerdictState, stage: Stage): ChipState {
	const i = STAGES.indexOf(stage)
	switch (v.kind) {
		case "idle":
			return "todo"
		case "settled":
			return "done"
		case "refused":
			return i === 0 ? "failed" : "todo"
		case "working":
		case "failed": {
			const at = STAGES.indexOf(v.stage)
			if (i < at) return "done"
			if (i > at) return "todo"
			return v.kind === "failed" ? "failed" : "active"
		}
	}
}

function title(v: VerdictState): string {
	if (v.kind === "working") return WORKING_TITLE[v.stage]
	return { idle: "Ready", settled: "Allowed", refused: "Refused", failed: "It did not go through" }[v.kind]
}

const banner = tv({
	base: "flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border px-4 py-3 transition-colors duration-300",
	variants: {
		kind: {
			idle: "border-line bg-white",
			working: "border-[#e8d3aa] bg-wait-soft",
			settled: "border-[#b5dcc4] bg-ok-soft",
			refused: "border-[#efc2bb] bg-bad-soft",
			failed: "border-[#efc2bb] bg-bad-soft",
		},
	},
})
const titleText = tv({
	base: "font-display text-xl font-[760] [font-stretch:88%]",
	variants: { kind: { idle: "text-ink", working: "text-wait", settled: "text-ok", refused: "text-bad", failed: "text-bad" } },
})
const chip = tv({
	base: "rounded-full px-2 py-1 font-mono text-[11.5px] font-medium transition-colors duration-300",
	variants: {
		state: {
			todo: "bg-idle-soft text-muted",
			active: "bg-wait-soft text-wait",
			done: "bg-ok-soft text-ok",
			failed: "bg-bad-soft text-bad",
		},
	},
})

function Icon({ kind }: { kind: VerdictState["kind"] }) {
	const common = { width: 22, height: 22, viewBox: "0 0 24 24" } as const
	if (kind === "settled")
		return (
			<svg {...common} aria-hidden="true" fill="none" stroke="#1d7447" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
				<path d="M5 12.5l4.5 4.5L19 7.5" />
			</svg>
		)
	if (kind === "refused" || kind === "failed")
		return (
			<svg {...common} aria-hidden="true" fill="none" stroke="#b93a2e" strokeWidth={2.4} strokeLinecap="round">
				<path d="M6 6l12 12M18 6L6 18" />
			</svg>
		)
	if (kind === "working")
		return (
			<svg {...common} aria-hidden="true" fill="#8f5c10">
				<circle cx="5" cy="12" r="2" />
				<circle cx="12" cy="12" r="2" />
				<circle cx="19" cy="12" r="2" />
			</svg>
		)
	return (
		<svg {...common} aria-hidden="true" fill="none" stroke="#566775" strokeWidth={2}>
			<circle cx="12" cy="12" r="7" />
		</svg>
	)
}

/** The banner under the stage: what the wallet is doing, and what the rules said. `stages` leaves out what an action skips. */
export function Verdict({ state, stages = STAGES }: { state: VerdictState; stages?: readonly Stage[] }) {
	return (
		<div className={banner({ kind: state.kind })} data-testid={TESTIDS.verdict} data-kind={state.kind} aria-live="polite">
			<span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white">
				<Icon kind={state.kind} />
			</span>
			<div className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
				<span className={titleText({ kind: state.kind })}>{title(state)}</span>
				{state.kind === "refused" && (
					<q className="font-mono text-[13px] text-bad" data-testid={TESTIDS.verdictRule}>
						{state.rule}
					</q>
				)}
				<span className="text-sm leading-snug">{state.detail}</span>
			</div>
			<ol className="flex shrink-0 gap-1.5" aria-label="Progress">
				{stages.map((s) => (
					<li key={s} className={chip({ state: chipState(state, s) })} data-stage={s} data-state={chipState(state, s)}>
						{LABEL[s]}
					</li>
				))}
			</ol>
		</div>
	)
}
