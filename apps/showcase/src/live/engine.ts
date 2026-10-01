import type { Address } from "viem"
import type { SendStage, StageFeed } from "@/demo/wallet"
import type { FeedRow, Holder } from "@/tour/player"
import { type LiveCtx, type Report, runDraft } from "./actions"
import { readBalances, resetDraft } from "./balances"
import type { ValidDraft } from "./draft"
import type { Outcome } from "./outcome"
import { finishPayouts, type Payout } from "./payouts"

export type { Payout, Report, SendStage }

/** Everything live mode asks of the chains; the component tests fake it, since bb.js does not run under jsdom. */
export interface LiveEngine {
	run(d: ValidDraft, report: Report): Promise<Outcome>
	balances(): Promise<Partial<Record<Holder, bigint>>>
	/** The refund that tops alice back up, or why there is none. */
	reset(): Promise<ValidDraft | string>
	payouts(onRow: (row: FeedRow) => void): Promise<Payout[]>
	stages: StageFeed
}

export function liveEngine(ctx: LiveCtx, wallets: Record<"A_demo" | "B_demo", Address>): LiveEngine {
	return {
		run: (d, report) => runDraft(ctx, d, wallets, report),
		balances: () => readBalances(ctx, wallets),
		reset: () => resetDraft(ctx),
		payouts: (onRow) => finishPayouts(ctx, wallets, onRow),
		stages: ctx.demo.stages,
	}
}
