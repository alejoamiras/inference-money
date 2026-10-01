import { useId, useState } from "react"
import { getAddress, isAddress } from "viem"
import { formatUsdc, parseUsdc } from "@/bridge/amount"
import type { ExitDetails, WithdrawFlow } from "@/bridge/withdraw-flow"
import { Button } from "@/components/ui/button"
import { TESTIDS } from "@/lib/testids"
import { Field, inputClass, Notice } from "./parts"

const TX_HASH = /^0x[0-9a-fA-F]{64}$/

export interface FinishFormProps {
	readonly flow: WithdrawFlow
	readonly notice: string | null
	readonly l1Account: string
	/** Set after an exit whose withdrawal could not be located: its exact details. */
	readonly prefill: ExitDetails | null
}

function parseDetails(hash: string, recipient: string, amount: string): ExitDetails | null {
	const a = parseUsdc(amount)
	if (!TX_HASH.test(hash.trim()) || !isAddress(recipient.trim(), { strict: false }) || !a.ok) return null
	return { l2TxHash: hash.trim().toLowerCase(), recipient: getAddress(recipient.trim()), amount: a.value }
}

export function FinishForm(p: FinishFormProps) {
	const id = useId()
	const [hash, setHash] = useState(p.prefill?.l2TxHash ?? "")
	const [recipient, setRecipient] = useState(p.prefill?.recipient ?? p.l1Account)
	const [amount, setAmount] = useState(p.prefill ? formatUsdc(p.prefill.amount).replaceAll(",", "") : "")
	const details = parseDetails(hash, recipient, amount)
	const amountResult = parseUsdc(amount)
	return (
		<form
			className="grid gap-4"
			onSubmit={(e) => {
				e.preventDefault()
				if (details) p.flow.finish(details)
			}}
		>
			<p className="text-sm text-muted-foreground">
				Finish a withdrawal started earlier. Enter its Aztec transaction hash, and the recipient and amount exactly as you entered
				them: all three must match the original withdrawal.
			</p>
			<Notice tone="warning">{p.notice}</Notice>
			<Field
				id={`${id}-hash`}
				label="Aztec transaction hash"
				error={hash && !TX_HASH.test(hash.trim()) ? "0x followed by 64 hex characters." : null}
			>
				<input
					id={`${id}-hash`}
					autoComplete="off"
					spellCheck={false}
					value={hash}
					onChange={(e) => setHash(e.target.value)}
					className={inputClass}
					data-testid={TESTIDS.finishTxHash}
				/>
			</Field>
			<Field
				id={`${id}-to`}
				label="Recipient (Ethereum address)"
				error={recipient && !isAddress(recipient.trim(), { strict: false }) ? "Enter an Ethereum address." : null}
			>
				<input
					id={`${id}-to`}
					autoComplete="off"
					spellCheck={false}
					value={recipient}
					onChange={(e) => setRecipient(e.target.value)}
					className={inputClass}
					data-testid={TESTIDS.finishRecipient}
				/>
			</Field>
			<Field id={`${id}-amount`} label="Amount (USDC)" error={amount && !amountResult.ok ? amountResult.error : null}>
				<input
					id={`${id}-amount`}
					inputMode="decimal"
					autoComplete="off"
					value={amount}
					onChange={(e) => setAmount(e.target.value)}
					className={inputClass}
					data-testid={TESTIDS.finishAmount}
				/>
			</Field>
			<Button type="submit" disabled={!details} data-testid={TESTIDS.finishSubmit}>
				Find and finish
			</Button>
		</form>
	)
}
