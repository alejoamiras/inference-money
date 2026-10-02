import { lazy, Suspense, useSyncExternalStore } from "react"
import { MANIFEST, PROVES } from "@/config/network"
import { useOpening } from "@/demo/useOpening"
import type { DemoWallet } from "@/demo/wallet"
import { TourMode } from "@/tour/TourMode"
import { Header, modeOf } from "@/ui/Header"

// Both load the Aztec SDK, which the recording must not wait for.
const ProvingPage = lazy(() => import("@/proving/ProvingPage").then((m) => ({ default: m.ProvingPage })))
const LiveRoot = lazy(() => import("@/live/LiveRoot").then((m) => ({ default: m.LiveRoot })))

const PROOFS = PROVES ? "real proofs" : "proofs off"
export const NETWORK_LABEL = MANIFEST.network === "testnet" ? `Aztec testnet · ${PROOFS}` : `Local network · ${PROOFS}`

const onHash = (notify: () => void) => {
	window.addEventListener("hashchange", notify)
	return () => window.removeEventListener("hashchange", notify)
}
const useHash = () => useSyncExternalStore(onHash, () => window.location.hash)

/** `demo` is opened once per page by the caller: React may mount this twice, the wallet's stores may not open twice. */
export function App({ demo }: { demo: Promise<DemoWallet> }) {
	const opening = useOpening(demo)
	const hash = useHash()
	if (hash === "#proving")
		return (
			<Suspense>
				<ProvingPage opening={opening} />
			</Suspense>
		)
	const mode = modeOf(hash)
	const header = <Header network={NETWORK_LABEL} mode={mode} />
	if (mode === "tour") return <TourMode header={header} />
	return (
		<Suspense fallback={header}>
			<LiveRoot header={header} opening={opening} />
		</Suspense>
	)
}
