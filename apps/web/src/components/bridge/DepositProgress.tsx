import { depositStatus } from "@inference-money/bridge-core"
import { useEffect, useState } from "react"
import { formatUsdc } from "@/bridge/amount"
import type { DepositFlow, DepositSnapshot, DepositStep } from "@/bridge/deposit-flow"
import { Button } from "@/components/ui/button"
import { shortHex } from "@/lib/cn"
import { TESTIDS } from "@/lib/testids"
import { FeeFallbackDialog, Notice, Progress } from "./parts"
import { Stepper } from "./Stepper"

const STEPS = ["Approve", "Sign", "Sent on Ethereum", "Ready on Aztec", "Claim", "Proven"] as const

const STEP_INDEX: Record<DepositStep, number> = {
	idle: 0,
	checking: 0,
	approving: 0,
	signing: 1,
	sending: 2,
	confirming: 2,
	stuck: 2,
	waiting: 3,
	paused: 3,
	claiming: 4,
	"fee-fallback": 4,
	"claim-failed": 4,
	finalizing: 5,
	done: STEPS.length,
}

const BLOCKED: ReadonlySet<DepositStep> = new Set(["stuck", "paused", "claim-failed", "fee-fallback"])

const WORKING: Partial<Record<DepositStep, string>> = {
	checking: "Checking your balance, the fees and the bridge…",
	approving: "Approve Permit2 in your Ethereum wallet, then wait for it to confirm…",
	signing: "Sign the deposit in your Ethereum wallet.",
	sending: "Send the deposit from your Ethereum wallet.",
	confirming: "Waiting for Ethereum to confirm the deposit…",
	waiting: "Waiting for Aztec to pick up the deposit. This usually takes a few minutes.",
	claiming: "Claiming on Aztec. Approve it in your Aztec wallet if asked.",
	finalizing:
		"Claimed. Keep this tab open while Aztec proves it: until then the claim can still be rolled back, and this tab holds what claims it again.",
}

function useNow(everyMs: number, on: boolean): number {
	const [now, setNow] = useState(() => Date.now())
	useEffect(() => {
		if (!on) return
		const t = setInterval(() => setNow(Date.now()), everyMs)
		return () => clearInterval(t)
	}, [everyMs, on])
	return now
}

function Actions({ flow, s }: { flow: DepositFlow; s: DepositSnapshot }) {
	if (s.step === "sending") {
		return (
			<div className="grid gap-1">
				<p className="text-xs text-muted-foreground">
					If your wallet already sent the deposit but this page never heard back, look for it on Ethereum instead. It is never
					sent twice.
				</p>
				<Button variant="ghost" onClick={flow.recheck} data-testid={TESTIDS.depositRecheck}>
					Look for it on Ethereum
				</Button>
			</div>
		)
	}
	if (s.step === "stuck") {
		return (
			<div className="flex flex-wrap gap-2">
				{s.l1TxHash ? (
					<Button onClick={flow.keepWaiting} data-testid={TESTIDS.depositKeepWaiting}>
						Keep waiting
					</Button>
				) : null}
				<Button variant="outline" onClick={flow.recheck} data-testid={TESTIDS.depositRecheck}>
					Re-check
				</Button>
				{s.canDiscard ? (
					<Button variant="ghost" onClick={flow.discard} data-testid={TESTIDS.depositDiscard}>
						Discard
					</Button>
				) : null}
			</div>
		)
	}
	if (s.step === "paused" || s.step === "claim-failed") {
		return (
			<Button onClick={flow.retryClaim} data-testid={TESTIDS.depositRetryClaim}>
				{s.step === "paused" ? "Check again" : "Retry the claim"}
			</Button>
		)
	}
	if (s.step === "done") {
		return (
			<Button variant="outline" onClick={flow.reset} data-testid={TESTIDS.depositReset}>
				New deposit
			</Button>
		)
	}
	return null
}

function doneText(s: DepositSnapshot): string {
	if (s.outcome === "already-claimed") return "This deposit was already claimed."
	const where = s.kind === "private" ? "private" : "public"
	return `Done. ${formatUsdc(s.amount ?? 0n)} USDC is in your ${where} balance on Aztec.`
}

export function DepositProgress({ flow, s }: { flow: DepositFlow; s: DepositSnapshot }) {
	const now = useNow(5_000, s.step === "waiting")
	const working = WORKING[s.step]
	return (
		<div className="grid gap-4" data-step={s.step}>
			<Stepper steps={STEPS} current={STEP_INDEX[s.step]} failed={BLOCKED.has(s.step)} />
			{s.amount !== null ? (
				<p className="text-sm">
					Depositing <span className="font-mono">{formatUsdc(s.amount)}</span> USDC ({s.kind})
					{s.l1TxHash ? (
						<>
							{" "}
							· Ethereum tx{" "}
							<span className="font-mono" title={s.l1TxHash}>
								{shortHex(s.l1TxHash)}
							</span>
						</>
					) : null}
				</p>
			) : null}
			{working && !s.notice ? <p className="text-sm text-muted-foreground">{working}</p> : null}
			{s.step === "waiting" && s.minedAt !== null ? <Progress progress={depositStatus(s.minedAt, 240_000, now)} /> : null}
			<Notice tone={BLOCKED.has(s.step) ? "warning" : "info"}>{s.notice}</Notice>
			{s.step === "done" ? <p className="text-sm font-medium">{doneText(s)}</p> : null}
			<Actions flow={flow} s={s} />
			<FeeFallbackDialog
				open={s.step === "fee-fallback"}
				what="deposit"
				reason={s.notice}
				onAccept={flow.acceptFeeFallback}
				onDecline={flow.declineFeeFallback}
			/>
		</div>
	)
}
