import { useLayoutEffect, useRef, useState } from "react"
import { tv } from "tailwind-variants"
import { TESTIDS } from "@/lib/testids"
import type { Holder } from "@/tour/player"
import type { Beat } from "@/tour/useTour"

/** One balance on the stage. */
export interface Card {
	holder: Holder
	name: string
	/** The role chip on an Aztec account; none on Ethereum. */
	role?: "user" | "merchant"
	sub: string
	figure: string
	foot?: string
}

/** The coin's trip: it leaves `from`, and lands on `to`, or bounces back from a refusal. */
export interface Flight {
	from: Holder
	to: Holder
	label: string
	ok: boolean
	/** Hidden while ready, at `from` while checking, travelling while moving, then landed or bounced back. */
	phase: Beat
}

type Point = { x: number; y: number }

const ring = tv({
	base: "transition-shadow duration-300",
	variants: {
		mark: {
			none: "",
			from: "shadow-[0_0_0_3px_#2775ca]",
			to: "shadow-[0_0_0_3px_#93b8e3]",
			refused: "shadow-[0_0_0_3px_#e5a39a]",
		},
	},
})
const roleChip = tv({
	base: "rounded-full px-1.5 py-0.5 font-mono text-[10.5px] font-semibold tracking-[0.08em]",
	variants: { role: { user: "bg-usdc-soft text-usdc-ink", merchant: "bg-ok-soft text-ok" } },
})

function markOf(c: Card, f: Flight | undefined): "none" | "from" | "to" | "refused" {
	if (!f || f.phase === "ready") return "none"
	if (c.holder === f.from) return "from"
	if (c.holder === f.to) return f.ok ? "to" : "refused"
	return "none"
}

function EthereumCard({ card, mark }: { card: Card; mark: ReturnType<typeof markOf> }) {
	return (
		<div
			className={`flex min-h-15 flex-col items-center justify-center rounded-xl bg-white p-1.5 text-center text-[13px] leading-[18px] ${ring({ mark })}`}
		>
			<b>{card.name}</b>
			<span>{card.sub}</span>
			{card.figure && (
				<span className="font-mono tabular-nums" data-testid={TESTIDS.balance} data-holder={card.holder}>
					{card.figure}
				</span>
			)}
		</div>
	)
}

function AztecCard({ card, mark }: { card: Card; mark: ReturnType<typeof markOf> }) {
	const border = card.role === "merchant" ? "border-2 border-ok" : "border border-line"
	return (
		<div className={`flex flex-col gap-1 rounded-2xl bg-white px-3.5 py-3 ${border} ${ring({ mark })}`}>
			<span className="flex items-center justify-between gap-2">
				<span className="font-display text-lg font-[740] [font-stretch:88%]">{card.name}</span>
				{card.role && <span className={roleChip({ role: card.role })}>{card.role.toUpperCase()}</span>}
			</span>
			<span className="text-xs text-muted">{card.sub}</span>
			<span className="font-mono text-[22px] font-semibold tabular-nums" data-testid={TESTIDS.balance} data-holder={card.holder}>
				{card.figure}
			</span>
			{card.foot && <span className="font-mono text-[11.5px] text-muted">{card.foot}</span>}
		</div>
	)
}

/** Each card's centre, relative to the stage, kept current as the stage resizes (which any card's reflow does). */
function useCentres(stage: React.RefObject<HTMLDivElement | null>) {
	const [centres, setCentres] = useState<Partial<Record<Holder, Point>>>({})
	useLayoutEffect(() => {
		const el = stage.current
		if (!el) return
		const measure = () => {
			const box = el.getBoundingClientRect()
			const next: Partial<Record<Holder, Point>> = {}
			for (const node of el.querySelectorAll<HTMLElement>("[data-card]")) {
				const r = node.getBoundingClientRect()
				next[node.dataset.card as Holder] = { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 }
			}
			setCentres(next)
		}
		measure()
		if (typeof ResizeObserver === "undefined") return
		const observer = new ResizeObserver(measure)
		observer.observe(el)
		return () => observer.disconnect()
	}, [stage])
	return centres
}

function coinAt(f: Flight, c: Partial<Record<Holder, Point>>): Point | undefined {
	const from = c[f.from]
	const to = c[f.to]
	if (!from || !to || f.phase === "ready" || f.phase === "checking") return from
	if (f.ok) return to
	// A refused coin stops halfway, where the rules stopped it, then comes back.
	return f.phase === "moving" ? { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 } : from
}

/** Ethereum above, Aztec below, and the coin travelling between them. */
export function Stage({ ethereum, aztec, flight }: { ethereum: readonly Card[]; aztec: readonly Card[]; flight?: Flight }) {
	const stage = useRef<HTMLDivElement>(null)
	const centres = useCentres(stage)
	const at = flight && coinAt(flight, centres)
	const from = flight && centres[flight.from]
	const to = flight && centres[flight.to]
	const stop = from && to && { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
	return (
		<div ref={stage} className="relative flex flex-col gap-3" data-testid={TESTIDS.stage}>
			<section className="rounded-xl bg-lane-l1 px-3.5 pt-2.5 pb-3.5" aria-label="Ethereum, public">
				<h3 className="m-0 mb-2 font-mono text-[11px] font-semibold tracking-[0.12em] text-muted">ETHEREUM · PUBLIC</h3>
				<div className="grid grid-cols-3 gap-3">
					{ethereum.map((c) => (
						<div key={c.holder} data-card={c.holder}>
							<EthereumCard card={c} mark={markOf(c, flight)} />
						</div>
					))}
				</div>
			</section>
			<section className="rounded-xl bg-lane-l2 px-3.5 pt-2.5 pb-4" aria-label="Aztec, private balances">
				<h3 className="m-0 mb-2 font-mono text-[11px] font-semibold tracking-[0.12em] text-muted">AZTEC · PRIVATE BALANCES</h3>
				<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
					{aztec.map((c) => (
						<div key={c.holder} data-card={c.holder}>
							<AztecCard card={c} mark={markOf(c, flight)} />
						</div>
					))}
				</div>
			</section>
			{flight && !flight.ok && flight.phase === "landed" && stop && (
				<span
					className="pointer-events-none absolute flex size-8 items-center justify-center rounded-full border-2 border-bad bg-bad-soft"
					style={{ left: stop.x - 16, top: stop.y - 16 }}
					aria-hidden="true"
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="#b93a2e"
						strokeWidth={3.2}
						strokeLinecap="round"
						aria-hidden="true"
					>
						<path d="M6 6l12 12M18 6L6 18" />
					</svg>
				</span>
			)}
			{flight && at && (
				<span
					className="pointer-events-none absolute flex h-[30px] w-[72px] items-center justify-center rounded-[15px] border-2 border-white font-mono text-[13px] font-semibold text-white shadow-[0_2px_8px_rgba(20,33,43,0.28)] transition-[left,top,opacity] duration-[900ms] ease-in-out"
					style={{
						left: at.x - 36,
						top: at.y - 15,
						background: flight.ok ? "#2775ca" : "#b93a2e",
						// Fades as it lands, or as it gets back from a refusal, so it never hides a balance.
						opacity: flight.phase === "ready" || flight.phase === "landed" ? 0 : 1,
					}}
					data-testid={TESTIDS.coin}
					aria-hidden="true"
				>
					{flight.label}
				</span>
			)}
		</div>
	)
}
