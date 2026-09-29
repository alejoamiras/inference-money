import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogFooter } from "@/components/ui/dialog"
import { cn, shortHex } from "@/lib/cn"
import { TESTIDS } from "@/lib/testids"
import type { AztecSessionSnapshot, AztecWalletSession, GrantedAccount } from "@/wallet/aztec-session"

/** An alias is wallet-claimed text; the address beside it is the identity. */
export function AccountLabel({ account }: { account: GrantedAccount }) {
	return (
		<span className="flex min-w-0 flex-col text-left">
			{account.alias ? <span className="truncate font-medium">{account.alias}</span> : null}
			<span className="font-mono text-xs text-muted-foreground" title={account.address}>
				{shortHex(account.address, 10, 8)}
			</span>
		</span>
	)
}

export function HiddenAccounts({ count, shown }: { count: number; shown: number }) {
	if (count === 0) return null
	return <p className="text-xs text-muted-foreground">{`Showing ${shown} of ${shown + count} accounts your wallet shared.`}</p>
}

export function AccountChooser({ snap, session }: { snap: AztecSessionSnapshot; session: AztecWalletSession }) {
	const [picked, setPicked] = useState<string | null>(null)
	const open = snap.status === "choosing-account"
	const choice = picked !== null && snap.accounts.some((a) => a.address === picked) ? picked : null
	return (
		<Dialog
			open={open}
			onDismiss={() => void session.cancelAccountChoice()}
			title="Choose an account"
			description="Your wallet shared several accounts. Pick the one to bridge with."
			testId={TESTIDS.accountChoice}
		>
			<ul className="grid max-h-80 gap-2 overflow-y-auto">
				{snap.accounts.map((a) => (
					<li key={a.address}>
						<button
							type="button"
							aria-pressed={choice === a.address}
							onClick={() => setPicked(a.address)}
							className={cn("w-full rounded-md border p-3", choice === a.address ? "border-primary" : "border-border")}
							data-testid={TESTIDS.accountChoiceRow}
							data-address={a.address}
						>
							<AccountLabel account={a} />
						</button>
					</li>
				))}
			</ul>
			<HiddenAccounts count={snap.hiddenAccountsCount} shown={snap.accounts.length} />
			<DialogFooter>
				<Button variant="outline" onClick={() => void session.cancelAccountChoice()} data-testid={TESTIDS.accountChoiceCancel}>
					Cancel
				</Button>
				<Button
					disabled={choice === null}
					onClick={() => choice && void session.confirmAccountChoice(choice)}
					data-testid={TESTIDS.accountChoiceContinue}
				>
					Continue
				</Button>
			</DialogFooter>
		</Dialog>
	)
}
