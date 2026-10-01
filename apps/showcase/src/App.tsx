import { useEffect, useState } from "react"
import { MANIFEST, PROVES } from "@/config/network"
import type { DemoWallet } from "@/demo/wallet"
import { TESTIDS } from "@/lib/testids"
import { ProvingCheck } from "@/proving/ProvingCheck"

type Opening = { status: "opening" } | { status: "ready"; demo: DemoWallet } | { status: "failed"; message: string }

function useOpening(demo: Promise<DemoWallet>): Opening {
	const [opening, setOpening] = useState<Opening>({ status: "opening" })
	useEffect(() => {
		let live = true
		demo.then(
			(d) => live && setOpening({ status: "ready", demo: d }),
			(e: unknown) => live && setOpening({ status: "failed", message: e instanceof Error ? e.message : String(e) }),
		)
		return () => {
			live = false
		}
	}, [demo])
	return opening
}

const STATUS_TEXT = { opening: "Opening the demo wallet…", ready: "The demo wallet is ready." } as const

function Cast({ demo }: { demo: DemoWallet }) {
	return (
		<ul className="grid gap-1 text-sm sm:grid-cols-2">
			{Object.values(demo.cast).map((p) => (
				<li key={p.actor} data-testid={TESTIDS.castMember} data-actor={p.actor} className="truncate">
					<span className="font-medium capitalize">{p.actor}</span>{" "}
					<span className="text-muted-foreground">{p.address.toString()}</span>
				</li>
			))}
		</ul>
	)
}

/** `demo` is opened once per page by the caller: React may mount this twice, the wallet's stores may not open twice. */
export function App({ demo }: { demo: Promise<DemoWallet> }) {
	const opening = useOpening(demo)
	return (
		<div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-4 py-6">
			<header>
				<h1 className="text-xl font-semibold">Compliant USDC</h1>
				<p className="text-sm text-muted-foreground">
					Ethereum ⇄ Aztec · {MANIFEST.network} · {PROVES ? "proven in this browser" : "proofs simulated"}
				</p>
			</header>
			<main className="flex flex-col gap-6">
				<p data-testid={TESTIDS.walletStatus} data-status={opening.status} className="text-sm">
					{opening.status === "failed" ? opening.message : STATUS_TEXT[opening.status]}
				</p>
				{opening.status === "ready" && <Cast demo={opening.demo} />}
				{opening.status === "ready" && <ProvingCheck demo={opening.demo} manifest={MANIFEST} />}
			</main>
		</div>
	)
}
