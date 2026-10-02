import type { ReactNode } from "react"
import { tv } from "tailwind-variants"
import { TESTIDS } from "@/lib/testids"

export type Mode = "tour" | "live"

/** In the URL, so a reload keeps the mode: `#recorded` is the recording, anything else "Try it yourself" (old `#live` links too); App takes `#proving` first. */
export const modeOf = (hash: string): Mode => (hash === "#recorded" ? "tour" : "live")

const PLAY = (
	<>
		<circle cx="12" cy="12" r="10" />
		<path d="m10 8 6 4-6 4z" />
	</>
)
const ARROW = (
	<>
		<path d="M5 12h14" />
		<path d="m12 5 7 7-7 7" />
	</>
)

const OTHER: Record<Mode, { to: Mode; href: string; label: string; icon: ReactNode; after: boolean }> = {
	live: { to: "tour", href: "#recorded", label: "Watch a recorded run", icon: PLAY, after: false },
	tour: { to: "live", href: "#live", label: "Try it yourself", icon: ARROW, after: true },
}

const link = tv({
	base: "inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-usdc no-underline hover:text-usdc-ink",
	variants: { after: { true: "flex-row-reverse" } },
})

export function Header({ network, mode }: { network: string; mode: Mode }) {
	const other = OTHER[mode]
	return (
		<header className="flex min-h-16 flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-line bg-white px-4 py-2.5 lg:px-7">
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
			<div className="flex flex-wrap items-center gap-x-4.5 gap-y-1">
				<a href={other.href} className={link({ after: other.after })} data-testid={TESTIDS.mode} data-mode={other.to}>
					<svg
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth={2}
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						{other.icon}
					</svg>
					{other.label}
				</a>
				<span
					className="rounded-full bg-usdc-soft px-2.5 py-1.5 font-mono text-xs font-medium text-usdc-ink"
					data-testid={TESTIDS.network}
				>
					{network}
				</span>
			</div>
		</header>
	)
}
