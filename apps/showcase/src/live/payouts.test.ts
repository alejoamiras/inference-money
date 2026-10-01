// @vitest-environment node
import { TxHash, TxStatus } from "@aztec-labs/aztec.js/tx"
import { type ExitTicket, encodeTicket } from "@inference-money/bridge-core"
import { describe, expect, it, vi } from "vitest"
import { MANIFEST, TOUR, WALLETS } from "@/config/network"
import type { PendingExit, Tickets } from "@/demo/tickets"
import type { DemoWallet } from "@/demo/wallet"
import type { LiveCtx } from "./actions"
import { finishPayouts } from "./payouts"

const HASH = TxHash.fromString(`0x${"12".repeat(32)}`)
const TICKET: ExitTicket = {
	l2TxHash: HASH,
	recipient: WALLETS.A_demo,
	amount: 10_000n,
	messageHash: `0x${"0a".repeat(32)}`,
	messageIndexInTx: 0,
}

/** Payouts are sent as soon as the proof is on Ethereum; `locate` stands for the node's view of the burn. */
const chain = vi.hoisted(() => ({ paid: 0, located: "ticket" as "ticket" | "reverted" }))
vi.mock("@inference-money/bridge-core", async (original) => ({
	...(await original<typeof import("@inference-money/bridge-core")>()),
	locateWithdrawal: async () => (chain.located === "ticket" ? TICKET : "reverted"),
	isExitWithdrawn: async () => false,
	finishWithdrawal: async () => {
		chain.paid++
		return `0x${"78".repeat(32)}`
	},
}))

function ctxWith(status: TxStatus, entries: unknown[]) {
	const store = new Map(entries.map((e) => [(e as PendingExit).id, e]))
	const tickets = {
		exits: () => [...store.values()] as PendingExit[],
		putExit: (e: PendingExit) => store.set(e.id, e),
		dropExit: (id: string) => store.delete(id),
	} as unknown as Tickets
	const receipt = { status, isDropped: () => status === TxStatus.DROPPED }
	const demo = { node: { getTxReceipt: async () => receipt } } as unknown as DemoWallet
	const ctx: LiveCtx = {
		demo,
		m: MANIFEST,
		l1RpcUrl: "http://127.0.0.1:9",
		tickets,
		tour: TOUR,
		explorer: undefined,
		requests: new Map(),
	}
	return { ctx, store }
}

const sent = { l2TxHash: HASH.toString(), recipient: WALLETS.A_demo, amount: "10000" }
const burned = (since = Date.now()): PendingExit => ({ id: "0", actor: "alice", since, sent })

describe("finishPayouts", () => {
	it("pays out a burn a reload interrupted, once checkpointed, and waits while it is not", async () => {
		const pending = ctxWith(TxStatus.PENDING, [burned()])
		expect(await finishPayouts(pending.ctx, WALLETS, () => {})).toMatchObject([{ id: "0", amount: 10_000n, state: "proving" }])
		const landed = ctxWith(TxStatus.CHECKPOINTED, [burned()])
		expect([await finishPayouts(landed.ctx, WALLETS, () => {}), chain.paid, landed.store.size]).toEqual([[], 1, 0])
	})

	it("drops a burn that never mined or reverted, and skips an unreadable entry without blocking the rest", async () => {
		const unknown = ctxWith(TxStatus.DROPPED, [burned(Date.now() - 11 * 60_000)])
		expect([await finishPayouts(unknown.ctx, WALLETS, () => {}), unknown.store.size]).toEqual([[], 0])
		chain.located = "reverted"
		const reverted = ctxWith(TxStatus.CHECKPOINTED, [burned()])
		expect([await finishPayouts(reverted.ctx, WALLETS, () => {}), reverted.store.size]).toEqual([[], 0])
		chain.located = "ticket"
		const paidBefore = chain.paid
		const unreadable = { id: "1", actor: "alice", since: 0, ticket: "not a ticket" }
		const mixed = ctxWith(TxStatus.CHECKPOINTED, [
			unreadable,
			{ id: "2", actor: "alice", since: 1, ticket: encodeTicket("exit", TICKET) },
		])
		expect([await finishPayouts(mixed.ctx, WALLETS, () => {}), chain.paid - paidBefore, mixed.store.size]).toEqual([[], 1, 0])
	})
})
