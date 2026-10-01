import { type RefObject, useCallback, useEffect, useRef, useState } from "react"
import { CHECKING } from "@/tour/frame"
import type { FeedRow, Holder } from "@/tour/player"
import type { SceneId } from "@/tour/scenes"
import { usdc2 } from "@/ui/format"
import type { Flight } from "@/ui/Stage"
import { STAGES, type Stage, type VerdictState } from "@/ui/Verdict"
import { type Draft, PRESETS, settle, tripOf, type ValidDraft, validate } from "./draft"
import type { LiveEngine, Payout } from "./engine"
import type { Outcome } from "./outcome"

/** Between runs, payouts are checked this often: an epoch proves on the order of minutes. */
export const PAYOUT_POLL_MS = 30_000

const WORKING: Record<Stage, string> = {
	simulate: CHECKING,
	prove: "The rules allow it. The wallet proves it here, in this browser.",
	send: "Sending it to the network.",
	settle: "Sent. Waiting for the network to include it.",
}

const IDLE: VerdictState = { kind: "idle", detail: "Pick a step, or set your own, then press Try it." }

const verdictOf = (o: Outcome, at: Stage): VerdictState => (o.kind === "failed" ? { kind: "failed", stage: at, detail: o.detail } : o)

/** An Ethereum deposit has nothing to prove. */
const stagesFor = (d: Pick<Draft, "action">): readonly Stage[] => (d.action === "deposit" ? STAGES.filter((s) => s !== "prove") : STAGES)

const coinLabel = (d: ValidDraft): string => (d.amount === undefined ? d.action : usdc2(d.amount))

/** What the chains showed: the feed's live rows, the balances, and the payouts still to come, checked between runs. */
function useChains(engine: LiveEngine | undefined, running: RefObject<boolean>) {
	const [rows, setRows] = useState<FeedRow[]>([])
	const [balances, setBalances] = useState<Partial<Record<Holder, bigint>>>()
	const [payouts, setPayouts] = useState<Payout[]>([])
	const addRow = useCallback((row: FeedRow) => setRows((r) => [row, ...r.filter((x) => x.key !== row.key)]), [])
	const tail = useRef(Promise.resolve())
	// One check at a time: two overlapping ones would each send the same payout.
	const refresh = useCallback(() => {
		if (!engine) return Promise.resolve()
		tail.current = tail.current.then(async () => {
			const [b, p] = await Promise.all([engine.balances().catch(() => undefined), engine.payouts(addRow).catch(() => undefined)])
			if (b) setBalances(b)
			if (p) setPayouts(p)
		})
		return tail.current
	}, [engine, addRow])
	useEffect(() => {
		void refresh()
	}, [refresh])
	useEffect(() => {
		if (!engine || payouts.length === 0) return
		const timer = setInterval(() => void (running.current || refresh()), PAYOUT_POLL_MS)
		return () => clearInterval(timer)
	}, [engine, payouts.length, refresh, running])
	return { rows, addRow, balances, payouts, refresh }
}

/** One run at a time: the verdict and the coin follow its stages, from the runner and from the wallet. */
function useRun(engine: LiveEngine | undefined, running: RefObject<boolean>, chains: ReturnType<typeof useChains>) {
	const [busy, setBusy] = useState(false)
	const [verdict, setVerdict] = useState<VerdictState>(IDLE)
	const [flight, setFlight] = useState<Flight>()
	const [stages, setStages] = useState<readonly Stage[]>(STAGES)
	const { addRow, refresh } = chains
	const execute = useCallback(
		async (d: ValidDraft) => {
			if (!engine || running.current) return
			running.current = true
			setBusy(true)
			setStages(stagesFor(d))
			const coin = { ...tripOf(d), label: coinLabel(d) }
			let at: Stage = "simulate"
			const report = (stage: Stage, detail?: string) => {
				at = stage
				setVerdict({ kind: "working", stage, detail: detail ?? WORKING[stage] })
				setFlight({ ...coin, ok: true, phase: stage === "simulate" ? "checking" : "moving" })
			}
			const unlisten = engine.stages.listen(report)
			try {
				const outcome = await engine.run(d, report)
				setVerdict(verdictOf(outcome, at))
				setFlight({ ...coin, ok: outcome.kind === "settled", phase: "landed" })
				if (outcome.kind === "settled") for (const row of [...outcome.rows].reverse()) addRow(row)
			} finally {
				unlisten()
				running.current = false
				setBusy(false)
				void refresh()
			}
		},
		[engine, running, addRow, refresh],
	)
	return { busy, verdict, setVerdict, flight, stages, execute }
}

export type LiveView = ReturnType<typeof useLive>

/** Live mode's state: the composer's draft, the run in flight, and what the chains showed. */
export function useLive(engine: LiveEngine | undefined) {
	const [draft, setDraft] = useState<Draft>(PRESETS.deposit)
	const [scene, setScene] = useState<SceneId | undefined>("deposit")
	const [error, setError] = useState<string>()
	const running = useRef(false)
	const chains = useChains(engine, running)
	const runner = useRun(engine, running, chains)
	const { execute, setVerdict } = runner
	return {
		...chains,
		...runner,
		draft,
		scene,
		error,
		edit: (patch: Partial<Draft>) => {
			setDraft((d) => settle({ ...d, ...patch }))
			setScene(undefined)
			setError(undefined)
		},
		pick: (id: SceneId) => {
			setDraft(PRESETS[id])
			setScene(id)
			setError(undefined)
		},
		run: () => {
			const checked = validate(draft)
			setError(checked.ok ? undefined : checked.error)
			if (checked.ok) void execute(checked.draft)
		},
		reset: () => {
			if (!engine || running.current) return
			void engine.reset().then((r) => (typeof r === "string" ? setVerdict({ kind: "idle", detail: r }) : execute(r)))
		},
	}
}
