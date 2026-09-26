import type { BridgeProgress } from "@inference-money/bridge-core"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogFooter } from "@/components/ui/dialog"
import { cn } from "@/lib/cn"
import { TESTIDS } from "@/lib/testids"

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warning" }) {
	if (!children) return null
	return (
		<p
			role={tone === "warning" ? "alert" : "status"}
			data-testid={TESTIDS.flowNotice}
			className={cn("rounded-md border p-3 text-sm", tone === "warning" ? "border-destructive/40 text-destructive" : "border-border")}
		>
			{children}
		</p>
	)
}

export function Field(p: { id: string; label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
	return (
		<div className="grid gap-1 text-sm">
			<label htmlFor={p.id} className="font-medium">
				{p.label}
			</label>
			{p.children}
			{p.error ? <span className="text-xs text-destructive">{p.error}</span> : null}
			{!p.error && p.hint ? <span className="text-xs text-muted-foreground">{p.hint}</span> : null}
		</div>
	)
}

export const inputClass =
	"h-9 w-full rounded-md border border-border bg-background px-3 font-mono text-sm outline-none focus-visible:border-ring"

export interface Choice<T extends string> {
	readonly value: T
	readonly label: string
}

/** A two-way switch rendered as radio buttons, so keyboard and screen readers get native semantics. */
export function Choices<T extends string>(p: {
	name: string
	value: T
	choices: readonly Choice<T>[]
	onChange: (v: T) => void
	testId: string
}) {
	return (
		<div role="radiogroup" className="inline-flex rounded-md border border-border p-0.5" data-testid={p.testId}>
			{p.choices.map((c) => (
				<label
					key={c.value}
					className={cn(
						"cursor-pointer rounded px-3 py-1 text-sm",
						p.value === c.value ? "bg-muted font-medium" : "text-muted-foreground",
					)}
				>
					<input
						type="radio"
						name={p.name}
						value={c.value}
						checked={p.value === c.value}
						onChange={() => p.onChange(c.value)}
						className="sr-only"
					/>
					{c.label}
				</label>
			))}
		</div>
	)
}

export function Progress({ progress }: { progress: BridgeProgress }) {
	return (
		<div className="grid gap-1">
			<div className="h-2 overflow-hidden rounded-full bg-muted">
				<div
					className={cn("h-full bg-primary transition-[width]", progress.indeterminate && "w-1/3 animate-pulse")}
					style={progress.indeterminate ? undefined : { width: `${Math.round(progress.fillFraction * 100)}%` }}
				/>
			</div>
			<span className="text-xs text-muted-foreground">{progress.label}</span>
		</div>
	)
}

export function Summary({ rows, testId }: { rows: readonly (readonly [string, ReactNode])[]; testId: string }) {
	return (
		<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm" data-testid={testId}>
			{rows.map(([k, v]) => (
				<div key={k} className="contents">
					<dt className="text-muted-foreground">{k}</dt>
					<dd className="font-mono break-all">{v}</dd>
				</div>
			))}
		</dl>
	)
}

/**
 * The sponsor could not pay. Paying from the user's own account is never automatic: it can link that account to
 * this transfer, so it takes this explicit choice.
 */
export function FeeFallbackDialog(p: { open: boolean; what: string; reason: string | null; onAccept: () => void; onDecline: () => void }) {
	return (
		<Dialog
			open={p.open}
			onDismiss={p.onDecline}
			title="The fee sponsor can't pay right now"
			testId={TESTIDS.feeFallback}
			description={
				<>
					{p.reason} You can pay the Aztec fee from your own account instead. Anyone watching Aztec could then link your account
					to this {p.what}.
				</>
			}
		>
			<DialogFooter>
				<Button variant="outline" onClick={p.onDecline} data-testid={TESTIDS.feeFallbackDecline}>
					Wait for the sponsor
				</Button>
				<Button onClick={p.onAccept} data-testid={TESTIDS.feeFallbackAccept}>
					Pay the fee myself
				</Button>
			</DialogFooter>
		</Dialog>
	)
}
