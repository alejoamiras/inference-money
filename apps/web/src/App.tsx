import { AztecConnect } from "@/components/aztec/AztecConnect"
import { BridgePanel } from "@/components/bridge/BridgePanel"
import { L1Connect } from "@/components/L1Connect"
import { MANIFEST } from "@/config/network"
import { aztecSession } from "@/wallet/session"
import { useAztecSession } from "@/wallet/useAztecSession"

export function App() {
	const snap = useAztecSession(aztecSession)
	return (
		<div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-4 py-6">
			<header className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="text-xl font-semibold">USDC Bridge</h1>
					<p className="text-sm text-muted-foreground">
						Ethereum ⇄ Aztec{MANIFEST.network === "testnet" ? " · testnet" : " · local"}
					</p>
				</div>
				<div className="flex flex-col items-end gap-2">
					<L1Connect />
					<AztecConnect snap={snap} session={aztecSession} />
				</div>
			</header>
			<main className="rounded-lg border border-border p-4 sm:p-6">
				<BridgePanel />
			</main>
		</div>
	)
}
