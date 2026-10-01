import type { ReactNode } from "react"
import { tv } from "tailwind-variants"
import { TESTIDS } from "@/lib/testids"
import type { Scene, SceneId } from "@/tour/scenes"

const label = "font-mono text-[11px] font-semibold tracking-[0.08em] text-muted"

const box = tv({
	base: "flex h-11 items-center rounded-lg border border-field px-2.5 text-sm text-ink transition-colors duration-300",
	variants: { lit: { true: "bg-[#eaf2fb]", false: "bg-white" }, mono: { true: "font-mono font-medium", false: "font-medium" } },
})

const chip = tv({
	base: "h-11 cursor-pointer rounded-full border px-3.5 text-[13.5px] font-medium text-ink transition-colors duration-300",
	variants: {
		on: { true: "", false: "border-line bg-white hover:bg-idle-soft" },
		cheat: { true: "", false: "" },
	},
	compoundVariants: [
		{ on: true, cheat: false, class: "border-[#93b8e3] bg-usdc-soft" },
		{ on: true, cheat: true, class: "border-[#e5a39a] bg-bad-soft" },
	],
})

/** One labelled box of the composer; its contents are a value on the tour and a control when live. */
export function Field({ name, children }: { name: string; children: ReactNode }) {
	return (
		<div className="flex min-w-0 flex-col gap-1.5" data-testid={TESTIDS.field} data-field={name}>
			<span className={label}>{name}</span>
			{children}
		</div>
	)
}

export function FieldValue({ value, lit, mono = false }: { value: string; lit: boolean; mono?: boolean }) {
	return <span className={box({ lit, mono })}>{value}</span>
}

/** The scene chips: the happy path first, then the cheats the rules refuse. */
export function SceneChips({ scenes, active, onPick }: { scenes: readonly Scene[]; active?: SceneId; onPick: (s: Scene) => void }) {
	const group = (cheat: boolean) =>
		scenes
			.filter((s) => s.cheat === cheat)
			.map((s) => (
				<button
					key={s.id}
					type="button"
					className={chip({ on: s.id === active, cheat })}
					aria-pressed={s.id === active}
					data-testid={TESTIDS.chip}
					data-scene={s.id}
					onClick={() => onPick(s)}
				>
					{s.label}
				</button>
			))
	// Each label wraps with its own chips, never left at the end of a line.
	return (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
			<div className="flex flex-wrap items-center gap-2">
				<span className={`${label} pr-1 text-ok`}>HAPPY PATH</span>
				{group(false)}
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<span className={`${label} pr-1 text-bad`}>TRY TO CHEAT</span>
				{group(true)}
			</div>
		</div>
	)
}

/** The "inside the wallets" panel: who acts, what they do, to whom, how much; then the scene chips. */
export function Composer({
	hint,
	aside,
	fields,
	action,
	chips,
}: {
	hint: string
	aside?: ReactNode
	fields: ReactNode
	action: ReactNode
	chips: ReactNode
}) {
	return (
		<section
			className="flex flex-col gap-3 rounded-[14px] border border-line bg-white px-4 py-3.5 lg:px-[18px]"
			data-testid={TESTIDS.composer}
			aria-labelledby="composer-title"
		>
			<div className="flex flex-wrap items-baseline justify-between gap-3">
				<h2 id="composer-title" className="m-0 font-mono text-xs font-semibold tracking-[0.08em] text-muted">
					INSIDE THE WALLETS
				</h2>
				<span className="flex items-center gap-3 text-[13px] text-muted">
					{hint}
					{aside}
				</span>
			</div>
			<div className="grid grid-cols-2 items-end gap-2.5 md:grid-cols-[140px_196px_176px_100px_minmax(0,1fr)]">
				{fields}
				<div className="col-span-2 md:col-span-1">{action}</div>
			</div>
			{chips}
		</section>
	)
}
