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

const RECORDING =
	MANIFEST.network === "testnet"
		? "the acceptance run on Aztec testnet, replayed step by step. No wallet, nothing sent."
		: "a run recorded on a local network, replayed step by step. No wallet, nothing sent."

function RecordedNotice() {
	return (
		<div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 rounded-[10px] border border-[#bcd3ee] bg-usdc-soft py-1.5 pr-2 pl-4">
			<svg
				width="18"
				height="18"
				viewBox="0 0 24 24"
				fill="none"
				stroke="#1f5fa6"
				strokeWidth={2}
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
			>
				<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
				<path d="M3 3v5h5" />
				<path d="M12 7v5l4 2" />
			</svg>
			<p className="m-0 min-w-0 flex-[1_1_300px] text-[13.5px] text-[#3d4e5c]">
				<strong className="text-sm text-ink">A recorded run</strong> · {RECORDING}
			</p>
			<a
				href="#live"
				className="inline-flex min-h-11 items-center rounded-full bg-usdc px-4.5 text-sm font-semibold text-white no-underline hover:bg-usdc-ink"
			>
				Try it yourself
			</a>
		</div>
	)
}

/** The recorded run (`#recorded`): the acceptance run's recording, replayed scene by scene. It needs no wallet and sends nothing. */
export function TourMode({ header, pace = PACE }: { header: ReactNode; pace?: Readonly<Record<Beat, number>> }) {
	const t = useTour(TOUR, pace, EXPLORER)
	const p = t.played[t.index]
	if (!p) throw new Error("the tour has no scenes")
	const { ethereum, aztec } = stageCards(WALLETS, (h) => signedUsdc(t.moves[h] ?? 0n), "Moved in this recording")
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
			notice={<RecordedNotice />}
			composer={composer}
			stage={<Stage ethereum={ethereum} aztec={aztec} flight={tourFlight(p, t.beat)} />}
			verdict={<Verdict state={tourVerdict(p, t.beat)} stages={stagesOf(p)} />}
			feed={<WorldFeed rows={t.feed} />}
		/>
	)
}
