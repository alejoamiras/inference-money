import { Button } from "@/components/ui/button"
import { Dialog, DialogFooter } from "@/components/ui/dialog"
import { TESTIDS } from "@/lib/testids"
import type { AztecSessionSnapshot, AztecWalletSession, DiscoveredWallet } from "@/wallet/aztec-session"
import { truncateName } from "@/wallet/aztec-session"

/** Wallet-claimed icons render only as inline images: a remote URL would leak the visit (and CSP refuses it anyway). */
const safeIcon = (icon: string | undefined) => (icon?.startsWith("data:image/") ? icon : undefined)

function WalletRow({ wallet, onPick }: { wallet: DiscoveredWallet; onPick: () => void }) {
	const icon = safeIcon(wallet.icon)
	return (
		<li
			className="flex items-center gap-3 rounded-md border border-border p-3"
			data-testid={TESTIDS.walletPickerRow}
			data-wallet-id={wallet.id}
		>
			{icon ? <img src={icon} alt="" className="size-8 rounded" /> : <span className="size-8 rounded bg-muted" />}
			<div className="min-w-0 flex-1">
				<p className="truncate font-medium">{truncateName(wallet.name, 32)}</p>
				<p className="text-xs text-muted-foreground">{wallet.type === "extension" ? "Browser extension" : "Web wallet"}</p>
			</div>
			<Button size="sm" onClick={onPick} data-testid={TESTIDS.walletPickerConnect}>
				Connect
			</Button>
		</li>
	)
}

/**
 * Every announcement gets its own row, even two claiming one name: any wallet can claim any name, so the rows are
 * never deduplicated, and the emoji check that follows is what proves which wallet answered.
 */
export function WalletPicker({ snap, session }: { snap: AztecSessionSnapshot; session: AztecWalletSession }) {
	const open = snap.pickerOpen && (snap.status === "discovering" || snap.status === "choosing")
	return (
		<Dialog
			open={open}
			onDismiss={session.cancelChoice}
			title="Choose an Aztec wallet"
			description={snap.scanning ? "Looking for wallets…" : "Pick the wallet to connect."}
			testId={TESTIDS.walletPicker}
		>
			{snap.autoReconnectDisabled ? (
				<p className="text-sm text-destructive">
					Two wallets answered with the same name. Pick yours carefully and check the emoji.
				</p>
			) : null}
			<ul className="grid gap-2">
				{snap.discoveredWallets.map((w) => (
					<WalletRow key={w.key} wallet={w} onPick={() => session.selectWallet(w.key)} />
				))}
			</ul>
			{snap.discoveredWallets.length === 0 && !snap.scanning ? <p className="text-sm">No Aztec wallet answered.</p> : null}
			<DialogFooter>
				<Button variant="outline" onClick={session.cancelChoice} data-testid={TESTIDS.walletPickerCancel}>
					Cancel
				</Button>
			</DialogFooter>
		</Dialog>
	)
}
