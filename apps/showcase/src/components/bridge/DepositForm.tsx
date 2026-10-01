import type { DepositKind } from "@inference-money/bridge-core"
import { useId, useState } from "react"
import { formatUsdc, parseUsdc } from "@/bridge/amount"
import type { DepositFlow } from "@/bridge/deposit-flow"
import { Button } from "@/components/ui/button"
import { TESTIDS } from "@/lib/testids"
import { Choices, Field, inputClass, Notice, Summary } from "./parts"

const KINDS = [
	{ value: "private", label: "Private" },
	{ value: "public", label: "Public" },
] as const

export const PRIVACY_COPY: Record<DepositKind, string> = {
	private:
		"Private hides who receives the USDC on Aztec. It does not hide how much you bridge or when: both are public on Ethereum. The claim asks your Aztec wallet to pay its fee through a shared sponsor; a wallet that pays from your own account instead links it to this deposit.",
	public: "Public names your Aztec account on Ethereum, and the USDC lands in your public Aztec balance.",
}

export interface DepositFormProps {
	readonly flow: DepositFlow
	readonly notice: string | null
	/** The connected Ethereum account and its USDC, undefined until read. */
	readonly l1Account: string
	readonly l1Balance: bigint | undefined
	readonly l2Account: string
	readonly paused: boolean
}

function amountError(text: string, balance: bigint | undefined): string | null {
	if (text.trim() === "") return null
	const r = parseUsdc(text)
	if (!r.ok) return r.error
	return balance !== undefined && r.value > balance ? "That is more than your USDC balance on Ethereum." : null
}

export function DepositForm(p: DepositFormProps) {
	const id = useId()
	const [text, setText] = useState("")
	const [kind, setKind] = useState<DepositKind>("private")
	const [reviewing, setReviewing] = useState(false)
	const parsed = parseUsdc(text)
	const error = amountError(text, p.l1Balance)
	if (reviewing && parsed.ok) {
		return <DepositReview {...p} amount={parsed.value} kind={kind} onBack={() => setReviewing(false)} />
	}
	return (
		<form
			className="grid gap-4"
			onSubmit={(e) => {
				e.preventDefault()
				if (parsed.ok && !error && !p.paused) setReviewing(true)
			}}
		>
			<Notice tone="warning">{p.notice}</Notice>
			<Field
				id={id}
				label="Amount (USDC)"
				error={error}
				hint={p.l1Balance === undefined ? undefined : `You have ${formatUsdc(p.l1Balance)} USDC on Ethereum.`}
			>
				<input
					id={id}
					inputMode="decimal"
					autoComplete="off"
					placeholder="0.00"
					value={text}
					onChange={(e) => setText(e.target.value)}
					className={inputClass}
					data-testid={TESTIDS.depositAmount}
				/>
			</Field>
			<div className="grid gap-2">
				<Choices name={`${id}-kind`} value={kind} choices={KINDS} onChange={setKind} testId={TESTIDS.depositKind} />
				<p className="text-xs text-muted-foreground">{PRIVACY_COPY[kind]}</p>
			</div>
			<Button type="submit" disabled={!parsed.ok || error !== null || p.paused} data-testid={TESTIDS.depositReview}>
				Review deposit
			</Button>
		</form>
	)
}

function DepositReview(p: DepositFormProps & { amount: bigint; kind: DepositKind; onBack: () => void }) {
	return (
		<div className="grid gap-4">
			<h2 className="font-medium">Review your deposit</h2>
			<Summary
				testId={TESTIDS.depositSummary}
				rows={[
					["Amount", `${formatUsdc(p.amount)} USDC`],
					["From (Ethereum)", p.l1Account],
					["To (Aztec)", p.l2Account],
					["Lands in", p.kind === "private" ? "Your private balance" : "Your public balance"],
				]}
			/>
			<p className="text-xs text-muted-foreground">{PRIVACY_COPY[p.kind]}</p>
			<p className="text-xs text-muted-foreground">
				The first time, your wallet asks you to let Permit2 (Uniswap's approval contract) move your USDC, with no limit. Each
				deposit still needs your signature, but the approval lasts until you revoke it: a Permit2 signature you give any other site,
				or a flaw in Permit2, could move that USDC.
			</p>
			<p className="text-xs font-medium">
				Keep this tab open until the claim is final. The key that claims it lives only in this tab; closing it early can leave the
				USDC unclaimable.
			</p>
			<div className="flex gap-2">
				<Button variant="outline" onClick={p.onBack} data-testid={TESTIDS.depositBack}>
					Back
				</Button>
				<Button
					onClick={() => p.flow.confirm({ amount: p.amount, kind: p.kind, recipient: p.l2Account })}
					data-testid={TESTIDS.depositConfirm}
				>
					Confirm deposit
				</Button>
			</div>
		</div>
	)
}
