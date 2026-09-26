import { Button } from "@/components/ui/button"
import { Dialog, DialogFooter } from "@/components/ui/dialog"
import { TESTIDS } from "@/lib/testids"
import type { AztecSessionSnapshot, AztecWalletSession } from "@/wallet/aztec-session"
import { toGrid } from "@/wallet/emoji"

/** The trust anchor of the connection: both sides derive these emoji from the shared channel key. */
export function VerificationDialog({ snap, session }: { snap: AztecSessionSnapshot; session: AztecWalletSession }) {
	const emojis = snap.status === "verifying" ? snap.verificationEmojis : null
	return (
		<Dialog
			open={emojis !== null}
			onDismiss={() => void session.cancelVerification()}
			title="Check the emoji"
			description="Your wallet shows nine emoji. Continue only if they are the same, in the same order."
			testId={TESTIDS.verificationModal}
		>
			<div className="mx-auto grid grid-cols-3 gap-3 text-3xl" data-testid={TESTIDS.verificationGrid}>
				{toGrid(emojis ?? "").map((e, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: a fixed 9-cell grid; position is the identity
					<span key={i} className="flex size-12 items-center justify-center rounded-md bg-muted">
						{e}
					</span>
				))}
			</div>
			<DialogFooter>
				<Button variant="outline" onClick={() => void session.cancelVerification()} data-testid={TESTIDS.btnVerifyCancel}>
					They differ
				</Button>
				<Button onClick={() => void session.confirmVerification()} data-testid={TESTIDS.btnVerifyConfirm}>
					They match
				</Button>
			</DialogFooter>
		</Dialog>
	)
}
