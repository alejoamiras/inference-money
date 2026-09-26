import { Button } from "@/components/ui/button"
import { L1_CHAIN } from "@/config/network"
import { shortHex } from "@/lib/cn"
import { TESTIDS } from "@/lib/testids"
import { useL1 } from "@/wallet/l1"

export function L1Connect() {
	const l1 = useL1()
	if (l1.status !== "connected" || !l1.address) {
		return (
			<div className="flex flex-col items-end gap-1" data-testid={TESTIDS.l1Status} data-status={l1.status}>
				<Button onClick={l1.connect} disabled={l1.status !== "disconnected" || !l1.hasProvider} data-testid={TESTIDS.l1Connect}>
					{l1.status === "disconnected" ? "Connect Ethereum wallet" : "Connecting…"}
				</Button>
				{l1.hasProvider ? null : <p className="text-xs text-muted-foreground">No Ethereum wallet found in this browser.</p>}
				{l1.error ? <p className="text-xs text-destructive">{l1.error.message}</p> : null}
			</div>
		)
	}
	return (
		<div className="flex items-center gap-2" data-testid={TESTIDS.l1Status} data-status={l1.wrongChain ? "wrong-chain" : "connected"}>
			{l1.wrongChain ? (
				<Button variant="destructive" size="sm" onClick={l1.switchChain} data-testid={TESTIDS.l1SwitchChain}>
					Switch to {L1_CHAIN.name}
				</Button>
			) : null}
			<span className="font-mono text-sm" title={l1.address} data-address={l1.address}>
				{shortHex(l1.address)}
			</span>
			<Button variant="ghost" size="sm" onClick={l1.disconnect} data-testid={TESTIDS.l1Disconnect}>
				Disconnect
			</Button>
		</div>
	)
}
