import { MANIFEST } from "@/config/network"
import type { Opening } from "@/demo/useOpening"
import { TESTIDS } from "@/lib/testids"
import { ProvingCheck } from "./ProvingCheck"

const STATUS_TEXT = { opening: "Opening the demo wallet…", ready: "The demo wallet is ready." } as const

/** `#proving`: the harness's page, which times this device's proving with the cast's accounts. */
export function ProvingPage({ opening }: { opening: Opening }) {
	return (
		<main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-6">
			<h1 className="m-0 font-display text-xl font-[760] [font-stretch:88%]">Proving check</h1>
			<p data-testid={TESTIDS.walletStatus} data-status={opening.status} className="text-sm">
				{opening.status === "failed" ? opening.message : STATUS_TEXT[opening.status]}
			</p>
			{opening.status === "ready" && (
				<ul className="grid gap-1 text-sm sm:grid-cols-2">
					{Object.values(opening.demo.cast).map((p) => (
						<li key={p.actor} data-testid={TESTIDS.castMember} data-actor={p.actor} className="truncate">
							<span className="font-medium capitalize">{p.actor}</span>{" "}
							<span className="text-muted">{p.address.toString()}</span>
						</li>
					))}
				</ul>
			)}
			{opening.status === "ready" && <ProvingCheck demo={opening.demo} manifest={MANIFEST} />}
		</main>
	)
}
