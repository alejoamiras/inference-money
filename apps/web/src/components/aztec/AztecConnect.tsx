import { DropdownMenu as M } from "radix-ui"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { shortHex } from "@/lib/cn"
import { TESTIDS } from "@/lib/testids"
import type { AztecSessionSnapshot, AztecWalletSession, ConnectStatus, SelectionNotice } from "@/wallet/aztec-session"
import { AccountChooser, AccountLabel, HiddenAccounts } from "./AccountChooser"
import { VerificationDialog } from "./VerificationDialog"
import { WalletPicker } from "./WalletPicker"

const PROGRESS: Partial<Record<ConnectStatus, string>> = {
	discovering: "Looking for wallets…",
	choosing: "Choose a wallet",
	verifying: "Check the emoji",
	"capability-approval": "Approve access in your wallet",
	"choosing-account": "Choose an account",
	"setting-up": "Setting up…",
}

function noticeText(n: SelectionNotice): string {
	if (n.kind === "grant-truncated") return `Your wallet shared more accounts than this app lists; ${n.hiddenCount} are hidden.`
	return `Using ${n.alias || shortHex(n.address ?? "")}, the account you picked last time.`
}

/** Drains the session's one-shot notices exactly once and shows the latest. */
function useLatestNotice(snap: AztecSessionSnapshot, session: AztecWalletSession): [string | null, () => void] {
	const [notice, setNotice] = useState<string | null>(null)
	useEffect(() => {
		if (snap.selectionNotices.length === 0) return
		const drained = session.consumeSelectionNotices()
		const last = drained.at(-1)
		if (last) setNotice(noticeText(last))
	}, [snap.selectionNotices, session])
	return [notice, () => setNotice(null)]
}

function AccountMenu({ snap, session }: { snap: AztecSessionSnapshot; session: AztecWalletSession }) {
	const selected = snap.accounts.find((a) => a.address === snap.selectedAccount)
	return (
		<M.Root>
			<M.Trigger asChild>
				<Button variant="outline" data-testid={TESTIDS.accountChip} title={snap.selectedAccount ?? undefined}>
					{selected?.alias || shortHex(snap.selectedAccount ?? "")}
				</Button>
			</M.Trigger>
			<M.Portal>
				<M.Content
					align="end"
					className="z-50 grid min-w-64 gap-1 rounded-md border border-border bg-background p-2 shadow-md"
					data-testid={TESTIDS.accountMenu}
				>
					{snap.accounts.map((a) => (
						<M.Item
							key={a.address}
							onSelect={() => session.selectAccount(a.address)}
							className="cursor-pointer rounded p-2 outline-none data-highlighted:bg-muted"
							data-testid={TESTIDS.accountMenuRow}
							data-address={a.address}
							data-selected={a.address === snap.selectedAccount}
						>
							<AccountLabel account={a} />
						</M.Item>
					))}
					<HiddenAccounts count={snap.hiddenAccountsCount} shown={snap.accounts.length} />
					<M.Separator className="my-1 h-px bg-border" />
					<M.Item
						onSelect={() => void session.disconnect()}
						className="cursor-pointer rounded p-2 text-sm outline-none data-highlighted:bg-muted"
						data-testid={TESTIDS.aztecDisconnect}
					>
						Disconnect
					</M.Item>
				</M.Content>
			</M.Portal>
		</M.Root>
	)
}

function StatusControl({ snap, session }: { snap: AztecSessionSnapshot; session: AztecWalletSession }) {
	if (snap.status === "connected") return <AccountMenu snap={snap} session={session} />
	if (snap.status === "error") {
		return (
			<div className="flex items-center gap-2">
				<span className="text-xs text-destructive" data-testid={TESTIDS.aztecError}>
					{snap.error?.message}
				</span>
				<Button variant="outline" size="sm" onClick={() => void session.connect()} data-testid={TESTIDS.aztecRetry}>
					Try again
				</Button>
			</div>
		)
	}
	const progress = PROGRESS[snap.status]
	if (progress) return <span className="text-sm text-muted-foreground">{progress}</span>
	const label = snap.preferredWalletName && !snap.autoReconnectDisabled ? `Connect ${snap.preferredWalletName}` : "Connect Aztec wallet"
	return (
		<Button onClick={() => void session.connect()} data-testid={TESTIDS.aztecConnect}>
			{label}
		</Button>
	)
}

export function AztecConnect({ snap, session }: { snap: AztecSessionSnapshot; session: AztecWalletSession }) {
	const [notice, dismiss] = useLatestNotice(snap, session)
	return (
		<div className="flex flex-col items-end gap-1" data-testid={TESTIDS.aztecStatus} data-status={snap.status}>
			<StatusControl snap={snap} session={session} />
			{notice ? (
				<p className="text-xs text-muted-foreground" role="status" data-testid={TESTIDS.notice}>
					{notice}{" "}
					<button type="button" className="underline" onClick={dismiss}>
						Dismiss
					</button>
				</p>
			) : null}
			<WalletPicker snap={snap} session={session} />
			<VerificationDialog snap={snap} session={session} />
			<AccountChooser snap={snap} session={session} />
		</div>
	)
}
