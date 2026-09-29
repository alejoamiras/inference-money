import { AztecAddress } from "@aztec/aztec.js/addresses"
import { assertExitIntent, type BridgeManifest } from "@inference-money/bridge-core"
import { useId, useState } from "react"
import { type Address, getAddress, isAddress } from "viem"
import { formatUsdc, parseUsdc } from "@/bridge/amount"
import type { L2BalanceKind } from "@/bridge/balances"
import type { WithdrawFlow } from "@/bridge/withdraw-flow"
import { Button } from "@/components/ui/button"
import { TESTIDS } from "@/lib/testids"
import { Choices, Field, inputClass, Notice, Summary } from "./parts"

const KINDS = [
	{ value: "private", label: "Private balance" },
	{ value: "public", label: "Public balance" },
] as const

/** The recipient the bridge itself would refuse (zero, the portal, the router), refused here before any review. */
export function recipientError(text: string, m: BridgeManifest): string | null {
	const t = text.trim()
	if (t === "") return null
	if (!isAddress(t, { strict: false })) return "Enter an Ethereum address: 0x followed by 40 hex characters."
	try {
		assertExitIntent({ kind: "private", from: AztecAddress.ZERO, recipientL1: getAddress(t), amount: 1n }, m)
		return null
	} catch (e) {
		return (e as Error).message
	}
}

export interface WithdrawFormProps {
	readonly flow: WithdrawFlow
	readonly manifest: BridgeManifest
	readonly notice: string | null
	readonly l1Account: string
	readonly l2Account: string
	readonly l2Balances: Readonly<Record<L2BalanceKind, bigint>> | undefined
	readonly paused: boolean
}

interface Draft {
	readonly amount: bigint
	readonly kind: L2BalanceKind
	readonly recipient: Address
}

function useWithdrawDraft(p: WithdrawFormProps) {
	const [text, setText] = useState("")
	const [kind, setKind] = useState<L2BalanceKind>("private")
	const [recipient, setRecipient] = useState(p.l1Account)
	const parsed = parseUsdc(text)
	const balance = p.l2Balances?.[kind]
	const amountErr =
		text.trim() === ""
			? null
			: !parsed.ok
				? parsed.error
				: balance !== undefined && parsed.value > balance
					? `That is more than your ${kind} balance.`
					: null
	const recipientErr = recipient.trim() === "" ? "Enter the Ethereum address to receive the USDC." : recipientError(recipient, p.manifest)
	const draft: Draft | null =
		parsed.ok && !amountErr && !recipientErr ? { amount: parsed.value, kind, recipient: getAddress(recipient.trim()) } : null
	return { text, setText, kind, setKind, recipient, setRecipient, balance, amountErr, recipientErr, draft }
}

export function WithdrawForm(p: WithdrawFormProps) {
	const id = useId()
	const d = useWithdrawDraft(p)
	const [review, setReview] = useState<Draft | null>(null)
	if (review) return <WithdrawReview {...p} draft={review} onBack={() => setReview(null)} />
	return (
		<form
			className="grid gap-4"
			onSubmit={(e) => {
				e.preventDefault()
				if (d.draft && !p.paused) setReview(d.draft)
			}}
		>
			<Notice tone="warning">{p.notice}</Notice>
			<div className="grid gap-2">
				<Choices name={`${id}-kind`} value={d.kind} choices={KINDS} onChange={d.setKind} testId={TESTIDS.withdrawKind} />
			</div>
			<Field
				id={`${id}-amount`}
				label="Amount (USDC)"
				error={d.amountErr}
				hint={d.balance === undefined ? undefined : `You have ${formatUsdc(d.balance)} USDC in your ${d.kind} balance.`}
			>
				<input
					id={`${id}-amount`}
					inputMode="decimal"
					autoComplete="off"
					placeholder="0.00"
					value={d.text}
					onChange={(e) => d.setText(e.target.value)}
					className={inputClass}
					data-testid={TESTIDS.withdrawAmount}
				/>
			</Field>
			<Field id={`${id}-to`} label="Send to (Ethereum address)" error={d.recipient ? d.recipientErr : null}>
				<input
					id={`${id}-to`}
					autoComplete="off"
					spellCheck={false}
					value={d.recipient}
					onChange={(e) => d.setRecipient(e.target.value)}
					className={inputClass}
					data-testid={TESTIDS.withdrawRecipient}
				/>
			</Field>
			<Button type="submit" disabled={!d.draft || p.paused} data-testid={TESTIDS.withdrawReview}>
				Review withdrawal
			</Button>
		</form>
	)
}

function WithdrawReview(p: WithdrawFormProps & { draft: Draft; onBack: () => void }) {
	return (
		<div className="grid gap-4">
			<h2 className="font-medium">Review your withdrawal</h2>
			<Summary
				testId={TESTIDS.withdrawSummary}
				rows={[
					["Amount", `${formatUsdc(p.draft.amount)} USDC`],
					["From (Aztec)", `${p.l2Account} (${p.draft.kind} balance)`],
					["To (Ethereum)", p.draft.recipient],
				]}
			/>
			<p className="text-xs text-muted-foreground">
				The USDC leaves Aztec at once, and reaches Ethereum after Aztec proves its block there: usually tens of minutes, sometimes
				longer. If you close this tab meanwhile, finish it later under “Finish a withdrawal” with the Aztec transaction hash shown
				next, this recipient and this amount.
			</p>
			<div className="flex gap-2">
				<Button variant="outline" onClick={p.onBack} data-testid={TESTIDS.withdrawBack}>
					Back
				</Button>
				<Button onClick={() => p.flow.exit({ ...p.draft, from: p.l2Account })} data-testid={TESTIDS.withdrawConfirm}>
					Confirm withdrawal
				</Button>
			</div>
		</div>
	)
}
