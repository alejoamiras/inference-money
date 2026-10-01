import { cn } from "@/lib/cn"
import { TESTIDS } from "@/lib/testids"

type StepState = "done" | "current" | "blocked" | "upcoming"

const DOT: Record<StepState, string> = {
	done: "border-primary bg-primary text-primary-foreground",
	current: "border-primary",
	blocked: "border-destructive text-destructive",
	upcoming: "border-border text-muted-foreground",
}

const LABEL: Record<StepState, string> = {
	done: "",
	current: "font-medium",
	blocked: "font-medium text-destructive",
	upcoming: "text-muted-foreground",
}

function stateOf(i: number, current: number, failed: boolean): StepState {
	if (i < current) return "done"
	if (i > current) return "upcoming"
	return failed ? "blocked" : "current"
}

/** `current` equal to `steps.length` marks every step done. */
export function Stepper({ steps, current, failed = false }: { steps: readonly string[]; current: number; failed?: boolean }) {
	return (
		<ol className="flex flex-wrap gap-x-4 gap-y-2 text-sm" data-testid={TESTIDS.stepper} data-current={steps[current] ?? "done"}>
			{steps.map((label, i) => {
				const state = stateOf(i, current, failed)
				return (
					<li key={label} data-state={state} className="flex items-center gap-2">
						<span aria-hidden className={cn("grid size-5 place-items-center rounded-full border text-xs", DOT[state])}>
							{state === "done" ? "✓" : i + 1}
						</span>
						<span className={LABEL[state]}>{label}</span>
					</li>
				)
			})}
		</ol>
	)
}
