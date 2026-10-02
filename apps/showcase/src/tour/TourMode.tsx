import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { EXPLORER, MANIFEST, TOUR, WALLETS } from "@/config/network"
import { Composer, Field, FieldValue, SceneChips } from "@/ui/Composer"
import { stageCards } from "@/ui/cards"
import { signedUsdc, usdc2 } from "@/ui/format"
import { Layout } from "@/ui/Layout"
import { Stage } from "@/ui/Stage"
import { Verdict } from "@/ui/Verdict"
import { WorldFeed } from "@/ui/WorldFeed"
import { stagesOf, tourFlight, tourVerdict } from "./frame"
import { SCENES } from "./scenes"
import { type Beat, PACE, useTour } from "./useTour"

/** The guided tour: the recorded acceptance run, replayed scene by scene. It needs no wallet and sends nothing. */
export function TourMode({ header, pace = PACE }: { header: ReactNode; pace?: Readonly<Record<Beat, number>> }) {
	const t = useTour(TOUR, pace, EXPLORER)
	const p = t.played[t.index]
	if (!p) throw new Error("the tour has no scenes")
	const { ethereum, aztec } = stageCards(WALLETS, (h) => signedUsdc(t.moves[h] ?? 0n), "Moved in this tour")
	const lit = t.beat === "ready"
	const replay = () => {
		t.setPlaying(true)
		t.goTo(t.index, "checking")
	}
	const composer = (
		<Composer
			hint={MANIFEST.network === "testnet" ? "Replaying the recorded testnet run." : "Replaying a recorded local run."}
			aside={
				<button
					type="button"
					className="cursor-pointer font-medium text-usdc underline-offset-2 hover:underline"
					onClick={() => t.setPlaying(!t.playing)}
				>
					{t.playing ? "Pause" : "Play"}
				</button>
			}
			fields={
				<>
					<Field name="ACT AS">
						<FieldValue value={p.scene.actorLabel} lit={lit} />
					</Field>
					<Field name="ACTION">
						<FieldValue value={p.scene.actionLabel} lit={lit} />
					</Field>
					<Field name="TO">
						<FieldValue value={p.scene.toLabel} lit={lit} />
					</Field>
					<Field name="USDC">
						<FieldValue value={usdc2(p.amount)} lit={lit} mono />
					</Field>
				</>
			}
			action={
				<Button className="w-full" onClick={replay}>
					Replay
				</Button>
			}
			chips={<SceneChips scenes={SCENES} active={p.scene.id} onPick={(s) => t.goTo(SCENES.indexOf(s))} />}
		/>
	)
	return (
		<Layout
			header={header}
			composer={composer}
			stage={<Stage ethereum={ethereum} aztec={aztec} flight={tourFlight(p, t.beat)} />}
			verdict={<Verdict state={tourVerdict(p, t.beat)} stages={stagesOf(p)} />}
			feed={<WorldFeed rows={t.feed} />}
		/>
	)
}
