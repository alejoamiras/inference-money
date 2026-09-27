import { AztecAddress } from "@aztec/aztec.js/addresses"
import { TxHash } from "@aztec/aztec.js/tx"
import {
	AlreadyWithdrawnError,
	assertExitIntent,
	type ExitIntent,
	ExitRevertedError,
	type ExitTicket,
	ExitUnconfirmedError,
	type FeeChoice,
	isUserRejection,
	type L1Ctx,
	MAX_PROOF_REBUILDS,
	type OutboxProof,
	type OutboxReader,
	outboxReader,
	SponsorUnavailableError,
	StaleProofError,
} from "@inference-money/bridge-core"
import type { Address, Hex } from "viem"
import { normalizeError } from "@/wallet/errors"
import type { L2BalanceKind } from "./balances"
import type { BridgeEnv, L2Ctx } from "./env"
import { explain } from "./explain"
import { createFlowStore } from "./flow-store"

export type WithdrawStep =
	| "idle"
	| "checking"
	| "exiting"
	| "fee-fallback"
	/** Burned on Aztec, but its withdrawal was not located: finish it from the tx hash, never exit again. */
	| "unconfirmed"
	| "locating"
	| "proving"
	| "withdrawing"
	| "other-tab"
	| "failed"
	| "done"

export interface ExitDetails {
	readonly l2TxHash: string
	readonly recipient: Address
	readonly amount: bigint
}

export interface WithdrawSnapshot {
	readonly step: WithdrawStep
	readonly kind: L2BalanceKind | null
	readonly amount: bigint | null
	readonly recipient: Address | null
	readonly l2TxHash: string | null
	readonly l1TxHash: Hex | null
	readonly outcome: "withdrawn" | "already-withdrawn" | null
	readonly notice: string | null
	/** What the finish form needs to resume an exit whose withdrawal could not be located. */
	readonly recovery: ExitDetails | null
	/** The L2 block the exit landed in and the proven block when the wait began, for a progress estimate. */
	readonly proving: { readonly neededBlock: number; readonly startBlock: number } | null
}

const IDLE: WithdrawSnapshot = {
	step: "idle",
	kind: null,
	amount: null,
	recipient: null,
	l2TxHash: null,
	l1TxHash: null,
	outcome: null,
	notice: null,
	recovery: null,
	proving: null,
}

export interface WithdrawRequest {
	readonly kind: L2BalanceKind
	readonly amount: bigint
	readonly recipient: Address
	/** The Aztec account the user reviewed; the exit refuses to leave from any other. */
	readonly from: string
}

const MAYBE_SENT =
	"Your wallet reported an error, but it may still have sent this withdrawal. Wait a few minutes, then check your " +
	"Aztec wallet's activity and your balance: if the withdrawal is listed or your balance dropped by this amount, " +
	"finish it below with its hash. Close this and withdraw again only if neither happened."

/**
 * Whether a failed exit send certainly broadcast nothing: an explicit refusal, a refused permission, a private
 * execution failure (it aborts before anything is proven) or a revert that burned nothing. Every other failure, a
 * lost connection included, may have come after the broadcast and is never answered with a fresh exit.
 */
function surelyUnsent(e: unknown): boolean {
	if (e instanceof ExitRevertedError || isUserRejection(e)) return true
	if (normalizeError(e).category === "capability-rejected") return true
	return /assertion failed/i.test(e instanceof Error ? e.message : String(e))
}

export const NOT_FOUND =
	"No withdrawal matching these details in that transaction. The recipient and amount must match the original exactly."

type Submitted = { readonly hash: Hex } | "already" | "other-tab" | "stale"

/** One tab submits a given exit: the lock is per origin, and the Outbox's nullifier backstops a crashed tab. */
export const withdrawLockName = (t: ExitTicket) =>
	`usdc-bridge/withdraw/${t.messageHash.toLowerCase()}/${t.l2TxHash.toString()}/${t.messageIndexInTx}`

/**
 * One withdrawal at a time: burn on Aztec, wait for the proof on Ethereum, withdraw there. Actions never reject; a
 * click while a step runs is ignored.
 */
export class WithdrawFlow {
	readonly store = createFlowStore<WithdrawSnapshot>(IDLE)
	readonly #env: BridgeEnv
	#ticket: ExitTicket | null = null
	#exit: ExitIntent | null = null
	/** What keeps the tab from closing unwarned: the located ticket, or the details an unlocated exit resumes from. */
	#guarded: object | null = null
	#busy = false

	constructor(env: BridgeEnv) {
		this.#env = env
	}

	readonly exit = (req: WithdrawRequest) => this.#act(["idle"], () => this.#startExit(req))

	/** Resumes from what the user can still name; all three must match the original exit. */
	readonly finish = (d: ExitDetails) => this.#act(["idle", "unconfirmed"], () => this.#locate(d))

	readonly retry = () => this.#act(["failed", "other-tab"], () => this.#finishTicket())

	/** The only path to a wallet-paid exit: the user accepted it may link their account to this withdrawal. */
	readonly acceptFeeFallback = () =>
		this.#act(["fee-fallback"], async () => {
			const t = await this.#env.gate.hold(async () => {
				const intent = this.#exit
				const l2 = this.#env.l2()
				if (!intent || !l2.account.equals(intent.from)) throw new Error("The Aztec account changed. Start the withdrawal again.")
				return this.#burn(intent, l2, "wallet-default")
			})
			if (t) await this.#finishTicket(t)
		})

	readonly declineFeeFallback = () =>
		this.#act(["fee-fallback"], async () => this.store.set({ ...IDLE, notice: "Nothing was sent. Try again later." }))

	/** Closes the screen; an unfinished withdrawal stays finishable from its tx hash, recipient and amount. */
	readonly reset = () =>
		this.#act(["idle", "done", "unconfirmed", "failed", "other-tab"], async () => {
			this.#guard(null)
			this.#ticket = null
			this.store.set(IDLE)
		})

	async #act(from: WithdrawStep[], fn: () => Promise<void>): Promise<void> {
		if (this.#busy || !from.includes(this.store.get().step)) return
		this.#busy = true
		try {
			await fn()
		} catch (e) {
			this.store.set({ notice: explain(e) })
		} finally {
			this.#busy = false
		}
	}

	#back(e: unknown): void {
		this.store.set({ ...IDLE, notice: typeof e === "string" ? e : explain(e) })
	}

	#guard(key: object | null): void {
		if (this.#guarded) this.#env.inFlight.remove(this.#guarded)
		this.#guarded = key
		if (key) this.#env.inFlight.add(key)
	}

	/**
	 * The account is read, checked and burned from under one hold, since a switch in between would burn from another
	 * account. Proving and the Ethereum side run after it: they no longer depend on the selected account.
	 */
	async #startExit(req: WithdrawRequest): Promise<void> {
		const env = this.#env
		this.store.set({ ...IDLE, step: "checking", kind: req.kind, amount: req.amount, recipient: req.recipient })
		const t = await env.gate.hold(async () => {
			let l2: L2Ctx
			let intent: ExitIntent
			try {
				l2 = env.l2()
				if (!l2.account.equals(AztecAddress.fromStringUnsafe(req.from))) {
					throw new Error("The Aztec account changed since you reviewed this withdrawal. Review it again.")
				}
				intent = { kind: req.kind, from: l2.account, recipientL1: req.recipient, amount: req.amount }
				assertExitIntent(intent, env.manifest)
				await this.#preflight(l2, req)
			} catch (e) {
				this.#back(e)
				return null
			}
			return this.#burn(intent, l2)
		})
		if (t) await this.#finishTicket(t)
	}

	async #preflight(l2: L2Ctx, req: WithdrawRequest): Promise<void> {
		const env = this.#env
		const [balance, paused] = await Promise.all([
			env.ops.l2Balance(l2, env.manifest, req.kind),
			env.ops.isBridgePaused(env.node, env.manifest),
		])
		if (paused) throw new Error("The bridge is paused. Withdrawals resume when it does.")
		if (balance < req.amount) throw new Error(`Your ${req.kind} USDC balance on Aztec is lower than this amount.`)
	}

	/** Burns under the caller's hold; the located ticket, or null once the failure is on screen. */
	async #burn(intent: ExitIntent, l2: L2Ctx, fee?: FeeChoice): Promise<ExitTicket | null> {
		const env = this.#env
		this.#exit = intent
		this.store.set({ step: "exiting", notice: null })
		try {
			const t = await env.ops.retryOnUnregistered(env.session, l2.wallet, () =>
				env.ops.exitToL1(intent, l2.wallet, env.node, env.manifest, { fee }),
			)
			this.#exit = null
			return t
		} catch (e) {
			this.#burnFailed(e, intent)
			return null
		}
	}

	#burnFailed(e: unknown, intent: ExitIntent): void {
		if (e instanceof SponsorUnavailableError) this.store.set({ step: "fee-fallback", notice: e.message })
		else if (e instanceof ExitUnconfirmedError) {
			this.#unconfirmed({ l2TxHash: e.l2TxHash.toString(), recipient: e.recipient, amount: e.amount }, e.message)
		} else if (surelyUnsent(e)) this.#back(e)
		else this.#unconfirmed({ l2TxHash: "", recipient: intent.recipientL1, amount: intent.amount }, MAYBE_SENT)
	}

	/** An exit that may have burned: only finishing it from its hash, or closing after checking the wallet, leaves here. */
	#unconfirmed(recovery: ExitDetails, notice: string): void {
		this.#exit = null
		this.#guard(recovery)
		this.store.set({ step: "unconfirmed", notice, recovery, l2TxHash: recovery.l2TxHash || null })
	}

	async #locate(d: ExitDetails): Promise<void> {
		const env = this.#env
		const { recovery } = this.store.get()
		// A burned exit's details are the only way back to it: a failed lookup returns to them, never to a blank form.
		const fail = (why: unknown) =>
			recovery
				? this.store.set({
						...IDLE,
						step: "unconfirmed",
						recovery,
						l2TxHash: recovery.l2TxHash || null,
						notice: typeof why === "string" ? why : explain(why),
					})
				: this.#back(why)
		this.store.set({ ...IDLE, step: "locating", l2TxHash: d.l2TxHash, recipient: d.recipient, amount: d.amount, recovery })
		let found: Awaited<ReturnType<typeof env.ops.exitTicketFromTx>>
		try {
			const l1 = await env.l1()
			const outbox = outboxReader(l1.publicClient, env.manifest.l1.outbox)
			found = await env.ops.exitTicketFromTx(TxHash.fromString(d.l2TxHash), d.recipient, d.amount, env.node, outbox, env.manifest)
		} catch (e) {
			return fail(e)
		}
		if (found === "not-found") return fail(NOT_FOUND)
		if (found === "all-consumed") {
			this.#guard(null)
			return this.store.set({ step: "done", outcome: "already-withdrawn" })
		}
		await this.#finishTicket(found)
	}

	async #finishTicket(t: ExitTicket | null = this.#ticket): Promise<void> {
		if (!t) return
		this.#ticket = t
		this.#guard(t)
		this.store.set({ step: "proving", notice: null, l2TxHash: t.l2TxHash.toString(), recipient: t.recipient, amount: t.amount })
		let outcome: Submitted = "stale"
		try {
			for (let attempt = 1; outcome === "stale" && attempt <= MAX_PROOF_REBUILDS; attempt++) outcome = await this.#proveAndSubmit(t)
		} catch (e) {
			return this.store.set({ step: "failed", notice: `${explain(e)} The withdrawal is kept; try again.` })
		}
		this.#settle(outcome)
	}

	async #proveAndSubmit(t: ExitTicket): Promise<Submitted> {
		const env = this.#env
		const l1 = await env.l1()
		const outbox = outboxReader(l1.publicClient, env.manifest.l1.outbox)
		this.store.set({ step: "proving", proving: await this.#provingWindow(t) })
		// Waiting happens outside the lock: only the submission must be single.
		const proof = await env.ops.waitWithdrawable(t, env.node, outbox, undefined, env.timing?.proof)
		return this.#submitLocked(t, proof, l1, outbox)
	}

	#submitLocked(t: ExitTicket, proof: OutboxProof, l1: L1Ctx, outbox: OutboxReader): Promise<Submitted> {
		const env = this.#env
		return env.locks.ifAvailable(withdrawLockName(t), async (held) => {
			if (!held) return "other-tab"
			// Re-read under the lock: another tab may have finished it between our proof and our lock.
			if (await env.ops.isExitWithdrawn(t, env.node, outbox)) return "already"
			this.store.set({ step: "withdrawing" })
			try {
				// Resolves only after the receipt, so the lock covers the "sent, not yet mined" window.
				return { hash: await env.ops.withdrawOnL1(t, proof, l1, env.manifest) }
			} catch (e) {
				if (e instanceof AlreadyWithdrawnError) return "already"
				if (e instanceof StaleProofError) return "stale"
				throw e
			}
		})
	}

	async #provingWindow(t: ExitTicket): Promise<WithdrawSnapshot["proving"]> {
		try {
			const [receipt, proven] = await Promise.all([this.#env.node.getTxReceipt(t.l2TxHash), this.#env.node.getBlockNumber("proven")])
			return receipt.blockNumber === undefined ? null : { neededBlock: Number(receipt.blockNumber), startBlock: Number(proven) }
		} catch {
			return null
		}
	}

	#settle(outcome: Submitted): void {
		if (outcome === "other-tab") {
			this.store.set({ step: "other-tab", notice: "Another tab is finishing this withdrawal. Keep it open, or check again here." })
		} else if (outcome === "stale") {
			this.store.set({
				step: "failed",
				notice: "Ethereum did not accept the proof yet. The withdrawal is kept; try again in a few minutes.",
			})
		} else {
			this.#guard(null)
			this.#ticket = null
			const withdrawn = outcome !== "already"
			this.store.set({
				step: "done",
				outcome: withdrawn ? "withdrawn" : "already-withdrawn",
				l1TxHash: withdrawn ? outcome.hash : null,
				notice: null,
			})
		}
	}
}
