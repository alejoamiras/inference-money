// @vitest-environment node
import type { SentTx } from "@inference-money/demo"
import { describe, expect, it } from "vitest"
import { MANIFEST, TOUR } from "@/config/network"
import type { DemoWallet } from "@/demo/wallet"
import type { LiveCtx } from "./actions"
import { replay, withConflictRetry } from "./actions"
import type { Outcome } from "./outcome"

const HASH = `0x${"12".repeat(32)}`

/** A context whose node knows one thing: whether this page's last send landed. */
function ctxWith(landed: boolean): LiveCtx {
	const sent: SentTx[] = []
	const node = {
		getTxReceipt: async () => ({ isMined: () => landed, hasExecutionSucceeded: () => landed }),
		getTxEffect: async () => undefined,
	}
	const demo = { sent, node } as unknown as DemoWallet
	return { demo, m: MANIFEST, l1RpcUrl: "", tickets: undefined as never, tour: TOUR, explorer: undefined, requests: new Map() }
}

const send = (ctx: LiveCtx) => ctx.demo.sent.push({ hash: HASH, feePayer: "0x0", expiresAt: 0n, anchorTs: 0n })
const DONE: Outcome = { kind: "settled", detail: "done", rows: [] }

describe("withConflictRetry", () => {
	it("settles on its own send that landed, without sending again", async () => {
		const ctx = ctxWith(true)
		let attempts = 0
		const outcome = await withConflictRetry(ctx, async () => {
			attempts++
			send(ctx)
			throw new Error("Tx dropped: Existing nullifier")
		}, ["transfer"])
		expect([attempts, outcome.kind, outcome.kind === "settled" && outcome.detail]).toEqual([
			1,
			"settled",
			"It went through: the network had it already.",
		])
	})

	it("runs once more on another tx's conflict, and lets anything else through untouched", async () => {
		const ctx = ctxWith(false)
		let attempts = 0
		const outcome = await withConflictRetry(ctx, async () => {
			if (attempts++ > 0) return DONE
			send(ctx)
			throw new Error("Duplicate nullifier in tx")
		}, ["transfer"])
		expect([attempts, outcome]).toEqual([2, DONE])
		const twice = withConflictRetry(ctx, async () => Promise.reject(new Error("Existing nullifier")), ["transfer"])
		await expect(twice).rejects.toThrow("Existing nullifier")
		await expect(withConflictRetry(ctx, async () => Promise.reject(new Error("Balance too low")), ["transfer"])).rejects.toThrow(
			"Balance too low",
		)
	})
})

describe("replay", () => {
	it("plays the recorded step, labelled recorded, and says why the live one could not run", () => {
		const outcome = replay(ctxWith(false), "deposit", "This Ethereum wallet holds 0.00 demo USDC, less than that.")
		expect(outcome).toMatchObject({
			kind: "settled",
			detail: /less than that\. This replays the recorded run instead, so nothing moved now\.$/,
		})
		expect(outcome.kind === "settled" && outcome.rows.map((r) => [r.key, r.source])).toEqual([["deposit", "recorded"]])
	})
})
