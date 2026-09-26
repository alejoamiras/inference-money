import { withdrawStatus } from "@inference-money/bridge-core"
import { useQuery } from "@tanstack/react-query"
import { formatUsdc } from "@/bridge/amount"
import { useBridge } from "@/bridge/context"
import type { WithdrawFlow, WithdrawSnapshot, WithdrawStep } from "@/bridge/withdraw-flow"
import { Button } from "@/components/ui/button"
import { shortHex } from "@/lib/cn"
import { TESTIDS } from "@/lib/testids"
import { FeeFallbackDialog, Notice, Progress } from "./parts"
import { Stepper } from "./Stepper"

const STEPS = ["Leave Aztec", "Proven on Ethereum", "Withdraw on Ethereum"] as const

const STEP_INDEX: Record<WithdrawStep, number> = {
	idle: 0,
	checking: 0,
	exiting: 0,
	"fee-fallback": 0,
	unconfirmed: 0,
	locating: 1,
	proving: 1,
	failed: 1,
	"other-tab": 2,
	withdrawing: 2,
	done: STEPS.length,
}

const BLOCKED: ReadonlySet<WithdrawStep> = new Set(["fee-fallback", "unconfirmed", "failed", "other-tab"])

const WORKING: Partial<Record<WithdrawStep, string>> = {
	checking: "Checking your balance and the bridge…",
	exiting: "Sending the withdrawal from Aztec. Approve it in your Aztec wallet if asked; proving takes a minute.",
	locating: "Looking up the withdrawal…",
	proving: "Waiting for Aztec to prove this block on Ethereum. This usually takes tens of minutes.",
	withdrawing: "Withdraw on Ethereum: confirm in your Ethereum wallet, then wait for it to confirm…",
}

function ProvingProgress({ s }: { s: WithdrawSnapshot }) {
	const { env } = useBridge()
	const span = s.proving
	const { data } = useQuery({
		queryKey: ["withdraw-proving", span?.neededBlock, span?.startBlock],
		queryFn: () => (span ? withdrawStatus(env.node, span.neededBlock, span.startBlock) : null),
		enabled: s.step === "proving" && span !== null,
		refetchInterval: 20_000,
	})
	return data ? <Progress progress={data} /> : null
}

function doneText(s: WithdrawSnapshot): string {
	if (s.outcome === "already-withdrawn") return "This withdrawal was already completed on Ethereum."
	return `Done. ${formatUsdc(s.amount ?? 0n)} USDC was sent to ${s.recipient} on Ethereum.`
}

export function WithdrawProgress({ flow, s }: { flow: WithdrawFlow; s: WithdrawSnapshot }) {
	const working = WORKING[s.step]
	return (
		<div className="grid gap-4" data-step={s.step}>
			<Stepper steps={STEPS} current={STEP_INDEX[s.step]} failed={BLOCKED.has(s.step)} />
			{s.l2TxHash && s.step !== "done" ? (
				<div className="grid gap-1 text-sm">
					<span className="text-muted-foreground">
						Save these to finish later: the Aztec transaction hash, {formatUsdc(s.amount ?? 0n)} USDC and the recipient.
					</span>
					<span className="font-mono break-all" data-testid={TESTIDS.withdrawTxHash}>
						{s.l2TxHash}
					</span>
				</div>
			) : null}
			{working && !s.notice ? <p className="text-sm text-muted-foreground">{working}</p> : null}
			{s.step === "proving" ? <ProvingProgress s={s} /> : null}
			<Notice tone={BLOCKED.has(s.step) ? "warning" : "info"}>{s.notice}</Notice>
			{s.step === "done" ? <p className="text-sm font-medium">{doneText(s)}</p> : null}
			{s.l1TxHash ? (
				<p className="text-sm">
					Ethereum tx{" "}
					<span className="font-mono" title={s.l1TxHash}>
						{shortHex(s.l1TxHash)}
					</span>
				</p>
			) : null}
			{s.step === "failed" || s.step === "other-tab" ? (
				<div className="flex flex-wrap gap-2">
					<Button onClick={flow.retry} data-testid={TESTIDS.withdrawRetry}>
						{s.step === "other-tab" ? "Check again" : "Try again"}
					</Button>
					<Button variant="ghost" onClick={flow.reset} data-testid={TESTIDS.withdrawReset}>
						Close
					</Button>
				</div>
			) : null}
			{s.step === "done" ? (
				<Button variant="outline" onClick={flow.reset} data-testid={TESTIDS.withdrawReset}>
					New withdrawal
				</Button>
			) : null}
			<FeeFallbackDialog
				open={s.step === "fee-fallback"}
				what="withdrawal"
				reason={s.notice}
				onAccept={flow.acceptFeeFallback}
				onDecline={flow.declineFeeFallback}
			/>
		</div>
	)
}
