import { TxHash, TxStatus } from "@aztec-labs/aztec.js/tx"
import {
	decodeExitTicket,
	type ExitTicket,
	encodeTicket,
	finishWithdrawal,
	isExitWithdrawn,
	locateWithdrawal,
	outboxReader,
} from "@inference-money/bridge-core"
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
const CHECKPOINTED: readonly TxStatus[] = [TxStatus.CHECKPOINTED, TxStatus.PROVEN, TxStatus.FINALIZED]
/** A load-balanced node may not know a tx another one accepted; a burn still unknown this long after never mined. */
const DROPPED_AFTER_MS = 10 * 60_000

/** `p`'s ticket, located from its burn once checkpointed when a reload came first; "none" when nothing was burned. */
async function ticketOf(ctx: LiveCtx, p: PendingExit): Promise<ExitTicket | "none" | "waiting"> {
	if (p.ticket) return decodeExitTicket(p.ticket)
	if (!p.sent) return "none"
	const hash = TxHash.fromString(p.sent.l2TxHash)
	const receipt = await ctx.demo.node.getTxReceipt(hash)
	if (receipt.isDropped()) return Date.now() - p.since > DROPPED_AFTER_MS ? "none" : "waiting"
	if (!CHECKPOINTED.includes(receipt.status)) return "waiting"
	const found = await locateWithdrawal(p.sent.recipient as Address, BigInt(p.sent.amount), hash, ctx.demo.node, ctx.m)
	if (found === "reverted") return "none"
	ctx.tickets.putExit({ ...p, ticket: encodeTicket("exit", found) })
	return found
}

/** Pays `t` out if its proof is on Ethereum, from the recipient's own demo wallet, which holds gas. */
async function pay(ctx: LiveCtx, wallets: Record<"A_demo" | "B_demo", Address>, t: ExitTicket, onRow: (row: FeedRow) => void) {
	const signer = demoL1(ctx.l1RpcUrl, ctx.m, isAddressEqual(t.recipient, wallets.B_demo) ? "bob" : "alice")
	const outbox = outboxReader(signer.publicClient, ctx.m.l1.outbox)
	if (await isExitWithdrawn(t, ctx.demo.node, outbox)) return
	const hash = await finishWithdrawal(t, ctx.demo.node, outbox, l1CtxOf(signer), ctx.m, undefined, ONE_POLL)
	const href = ctx.explorer && `${ctx.explorer.l1Tx}${hash}`
	onRow({ key: hash, source: "live", chain: "ethereum", text: PUBLIC_TEXT.withdraw, items: withdrawWorld(t.recipient, t.amount), href })
}

/** The recipient and amount `p` names, or nothing when neither its burn nor its ticket reads. */
function shownOf(p: PendingExit): Omit<Payout, "state"> | undefined {
	if (p.sent) return { id: p.id, recipient: p.sent.recipient as Address, amount: BigInt(p.sent.amount) }
	try {
		const t = decodeExitTicket(p.ticket ?? "")
		return { id: p.id, recipient: t.recipient, amount: t.amount }
	} catch {
		return undefined
	}
}

/** Pays `p` out when it can; else what the page shows of it. An entry naming nothing readable is dropped. */
async function payOne(
	ctx: LiveCtx,
	wallets: Record<"A_demo" | "B_demo", Address>,
	p: PendingExit,
	onRow: (row: FeedRow) => void,
): Promise<Payout | undefined> {
	const shown = shownOf(p)
	if (!shown) {
		ctx.tickets.dropExit(p.id)
		return undefined
	}
	try {
		const t = await ticketOf(ctx, p)
		if (t === "waiting") return { ...shown, state: "proving" }
		if (t !== "none") await pay(ctx, wallets, t, onRow)
		ctx.tickets.dropExit(p.id)
		return undefined
	} catch (e) {
		const text = e instanceof Error ? e.message : String(e)
		const proving = NOT_PROVEN.test(text)
		return { ...shown, state: proving ? "proving" : "stuck", note: proving ? undefined : text }
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
