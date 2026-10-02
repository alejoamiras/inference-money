import { tv } from "tailwind-variants"
import { TESTIDS } from "@/lib/testids"

export type Mode = "tour" | "live"

const MODES: readonly [Mode, string][] = [
	["tour", "Guided tour"],
	["live", "Try it yourself"],
]

const modeButton = tv({
	base: "h-10 cursor-pointer rounded-[7px] border-0 px-4 text-sm font-semibold transition-colors duration-200",
	variants: { on: { true: "bg-ink text-white", false: "bg-transparent text-[#3d4e5c] hover:bg-white/60" } },
})

/** The brand, the mode switch when there is a choice, and the network the page acts on. */
export function Header({ network, mode, onMode }: { network: string; mode: Mode; onMode?: (m: Mode) => void }) {
	return (
		<header className="flex min-h-16 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-line bg-white px-4 py-3 lg:px-7">
			<div className="flex items-center gap-3">
				<span
					className="flex size-[30px] items-center justify-center rounded-full bg-usdc font-display text-[15px] font-extrabold text-white"
					aria-hidden="true"
				>
					G
				</span>
				<h1 className="m-0 font-display text-xl font-[760] [font-stretch:88%]">Galactica USDC</h1>
				<span className="text-sm text-muted">Live demo</span>
			</div>
			{onMode && (
				<fieldset className="flex gap-1 rounded-[10px] bg-idle-soft p-1">
					<legend className="sr-only">Demo mode</legend>
					{MODES.map(([m, label]) => (
						<button
							key={m}
							type="button"
							className={modeButton({ on: m === mode })}
							aria-pressed={m === mode}
							data-testid={TESTIDS.mode}
							data-mode={m}
							onClick={() => onMode(m)}
						>
							{label}
						</button>
					))}
				</fieldset>
			)}
			<span
				className="rounded-full bg-usdc-soft px-2.5 py-1.5 font-mono text-xs font-medium text-usdc-ink"
				data-testid={TESTIDS.network}
			>
				{network}
			</span>
		</header>
	)
}
