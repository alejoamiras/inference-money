import { decodeExitTicket, finishWithdrawal, isExitWithdrawn, outboxReader } from "@inference-money/bridge-core"
import { demoL1, l1CtxOf, withdrawWorld } from "@inference-money/demo"
import { type Address, isAddressEqual } from "viem"
import type { PendingExit } from "@/demo/tickets"
import { type FeedRow, PUBLIC_TEXT } from "@/tour/player"
import type { LiveCtx } from "./actions"

/** A withdrawal burned on Aztec whose Ethereum payout is still to come. */
export interface Payout {
	id: string
	recipient: Address
	amount: bigint
	/** Waiting for Ethereum to accept the proof of its block, or stuck for a reason the page shows. */
	state: "proving" | "stuck"
	note?: string
}

/** Not proven yet: one poll, never a wait, so a page check stays short. */
const ONE_POLL = { timeoutMs: 0 }
const NOT_PROVEN = /not proven on Ethereum yet/

/** Pays `p` out if its proof is on Ethereum, from the recipient's own demo wallet, which holds gas; else says why not. */
async function payOne(
	ctx: LiveCtx,
	wallets: Record<"A_demo" | "B_demo", Address>,
	p: PendingExit,
	onRow: (row: FeedRow) => void,
): Promise<Payout | undefined> {
	const t = decodeExitTicket(p.ticket)
	const signer = demoL1(ctx.l1RpcUrl, ctx.m, isAddressEqual(t.recipient, wallets.B_demo) ? "bob" : "alice")
	const outbox = outboxReader(signer.publicClient, ctx.m.l1.outbox)
	try {
		if (!(await isExitWithdrawn(t, ctx.demo.node, outbox))) {
			const hash = await finishWithdrawal(t, ctx.demo.node, outbox, l1CtxOf(signer), ctx.m, undefined, ONE_POLL)
			const href = ctx.explorer && `${ctx.explorer.l1Tx}${hash}`
			const items = withdrawWorld(t.recipient, t.amount)
			onRow({ key: hash, source: "live", chain: "ethereum", text: PUBLIC_TEXT.withdraw, items, href })
		}
		ctx.tickets.dropExit(p.id)
		return undefined
	} catch (e) {
		const text = e instanceof Error ? e.message : String(e)
		const proving = NOT_PROVEN.test(text)
		return {
			id: p.id,
			recipient: t.recipient,
			amount: t.amount,
			state: proving ? "proving" : "stuck",
			note: proving ? undefined : text,
		}
	}
}

/** Pays out every pending withdrawal that can be; returns the ones still to come. One already paid elsewhere is dropped. */
export async function finishPayouts(
	ctx: LiveCtx,
	wallets: Record<"A_demo" | "B_demo", Address>,
	onRow: (row: FeedRow) => void,
): Promise<Payout[]> {
	const left: Payout[] = []
	for (const p of ctx.tickets.exits()) {
		const still = await payOne(ctx, wallets, p, onRow)
		if (still) left.push(still)
	}
	return left
}
