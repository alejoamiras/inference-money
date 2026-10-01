import { tv } from "tailwind-variants"
import { TESTIDS } from "@/lib/testids"
import type { FeedRow } from "@/tour/player"
import { itemValue } from "./format"

const CHAIN_LABEL: Record<FeedRow["chain"], string> = { ethereum: "ETHEREUM", aztec: "AZTEC", none: "NO TRANSACTION" }

const tag = tv({
	base: "shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10.5px] font-semibold tracking-[0.08em]",
	variants: {
		chain: { ethereum: "bg-[#26384a] text-world-text", aztec: "bg-[#1d3b36] text-[#9fd8c8]", none: "bg-[#2c3137] text-[#aab4bd]" },
	},
})
const item = tv({
	base: "rounded-full px-2 py-0.5 font-mono text-[11px]",
	variants: { visibility: { readable: "bg-readable text-readable-ink", hidden: "bg-hidden text-hidden-ink" } },
})

function Row({ row, latest }: { row: FeedRow; latest: boolean }) {
	return (
		<li
			className={`flex flex-col gap-1.5 rounded-xl px-3.5 py-3 transition-colors duration-500 ${latest ? "bg-world-row" : "bg-white/5"}`}
			data-testid={TESTIDS.feedRow}
			data-step={row.key}
			data-chain={row.chain}
		>
			<div className="flex items-center gap-2">
				<span className={tag({ chain: row.chain })}>{CHAIN_LABEL[row.chain]}</span>
				<span className="text-sm leading-snug">{row.text}</span>
				<span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-[10.5px] tracking-[0.08em] text-world-muted">
					<span data-testid={TESTIDS.feedSource}>{row.source.toUpperCase()}</span>
					{row.href && (
						<a
							className="text-world-text underline underline-offset-2"
							href={row.href}
							target="_blank"
							rel="noopener noreferrer"
						>
							TX ↗
						</a>
					)}
				</span>
			</div>
			{row.items.length > 0 && (
				<ul className="flex flex-wrap gap-1.5">
					{row.items.map((w) => (
						<li
							key={`${w.chain}:${w.label}`}
							className={item({ visibility: w.visibility })}
							data-visibility={w.visibility}
							title={w.value}
						>
							{w.visibility === "hidden" ? `hidden: ${w.label}` : `${w.label}: ${itemValue(w)}`}
						</li>
					))}
				</ul>
			)}
		</li>
	)
}

/** The public chains' view, newest first: the same fields anyone reads when production accounts do this. */
export function WorldFeed({ rows }: { rows: readonly FeedRow[] }) {
	return (
		<section className="flex min-w-0 grow flex-col gap-2.5 bg-world p-5 text-world-ink lg:p-6" aria-labelledby="world-title">
			<div className="flex items-center gap-2.5">
				<svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="#97a7b3"
					strokeWidth={2}
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
					<circle cx="12" cy="12" r="3" />
				</svg>
				<h2 id="world-title" className="m-0 font-mono text-xs font-semibold tracking-[0.1em] text-world-muted">
					WHAT THE WORLD SEES
				</h2>
			</div>
			<p className="m-0 text-sm leading-normal text-world-text">
				What anyone reading Ethereum and Aztec learns when real accounts do the same. The demo's own keys are public, so its
				accounts keep nothing from you; a production account's would. A refused attempt never leaves the wallet, so it leaves no
				trace.
			</p>
			{rows.length === 0 ? (
				<p className="m-0 rounded-xl border border-dashed border-world-line p-3.5 text-sm text-world-muted">
					Nothing public yet: run a step.
				</p>
			) : (
				<ol className="m-0 flex list-none flex-col gap-2.5 p-0">
					{rows.map((r, i) => (
						<Row key={r.key} row={r} latest={i === 0} />
					))}
				</ol>
			)}
			<div className="mt-auto flex flex-wrap items-center gap-x-3.5 gap-y-2 pt-2 text-[12.5px] text-world-muted">
				<span className="flex items-center gap-1.5">
					<span className={item({ visibility: "readable" })}>readable</span>anyone can see it
				</span>
				<span className="flex items-center gap-1.5">
					<span className={item({ visibility: "hidden" })}>hidden</span>only the people involved know
				</span>
			</div>
		</section>
	)
}
