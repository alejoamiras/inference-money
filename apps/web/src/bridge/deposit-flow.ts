import { AztecAddress } from "@aztec/aztec.js/addresses"
import {
	awaitL1Receipt,
	BridgePausedError,
	type ClaimTicket,
	type DepositDraft,
	type DepositKind,
	type FeeChoice,
	type L1Ctx,
	type Reconciled,
	SponsorUnavailableError,
	sendChain,
	signerOf,
} from "@inference-money/bridge-core"
import { erc20Abi, type Hex, maxUint256 } from "viem"
import { shortHex } from "@/lib/cn"
import { l1UsdcBalance, permit2Allowance } from "./balances"
import type { BridgeEnv, L2Ctx } from "./env"
import { explain } from "./explain"
import { createFlowStore } from "./flow-store"

export type DepositStep =
	| "idle"
	| "checking"
	| "approving"
	| "signing"
	| "sending"
	| "confirming"
	/** Sent, or maybe sent, but not seen mined: only ever re-checked, never re-sent. */
	| "stuck"
	| "waiting"
	| "paused"
	| "claiming"
	| "fee-fallback"
	| "claim-failed"
	/** Claimed in a checkpoint; the secret is kept until the claim is finalized. */
	| "finalizing"
	| "done"

export interface DepositSnapshot {
	readonly step: DepositStep
	readonly amount: bigint | null
	readonly kind: DepositKind | null
	readonly recipient: string | null
	readonly approvalTx: Hex | null
	readonly l1TxHash: Hex | null
	/** When the deposit was seen mined; the claim wait is estimated from it. */
	readonly minedAt: number | null
	readonly outcome: ClaimOutcome | null
	/** Why the flow stopped where it did; null while it runs. */
	readonly notice: string | null
	/** Only after a complete scan proved the deposit never reached Ethereum. */
	readonly canDiscard: boolean
}

const IDLE: DepositSnapshot = {
	step: "idle",
	amount: null,
	kind: null,
	recipient: null,
	approvalTx: null,
	l1TxHash: null,
	minedAt: null,
	outcome: null,
	notice: null,
	canDiscard: false,
}

const KEPT = "Your deposit is kept in this tab; keep it open."

type ClaimOutcome = "claimed" | "already-claimed"

export interface DepositRequest {
	readonly amount: bigint
	readonly kind: DepositKind
	/** The Aztec account the user reviewed as the recipient; the deposit refuses to name any other. */
	readonly recipient: string
}

/** Fail-closed reads right before anything is signed: any failure, shortfall or pause stops the flow. */
async function confirmReads(env: BridgeEnv, l1: L1Ctx, amount: bigint): Promise<{ allowance: bigint; l1Now: bigint }> {
	const m = env.manifest
	const [balance, allowance, , paused, head] = await Promise.all([
		l1UsdcBalance(l1.publicClient, m, l1.account),
		permit2Allowance(l1.publicClient, m, l1.account),
		env.ops.predictedWorstMinFees(env.node),
		env.ops.isBridgePaused(env.node, m),
		l1.publicClient.getBlock(),
	])
	if (paused) throw new BridgePausedError()
	if (balance < amount) throw new Error("Your USDC balance on Ethereum is lower than this amount.")
	// Permit2 checks the deadline against block time. The later of L1's head and this machine's clock keeps a stale
	// head (an idle local chain) or a slow clock from shortening it; a later deadline only delays a "not deposited".
	const wall = BigInt(Math.floor(Date.now() / 1000))
	return { allowance, l1Now: head.timestamp > wall ? head.timestamp : wall }
}

/**
 * One deposit at a time, from the reviewed amount to USDC claimed on Aztec. Actions never reject: every failure lands
 * in the snapshot's step and notice. A click while a step runs is ignored, never queued.
 */
export class DepositFlow {
	readonly store = createFlowStore<DepositSnapshot>(IDLE)
	readonly #env: BridgeEnv
	#draft: DepositDraft | null = null
	#ticket: ClaimTicket | null = null
	/** The running action's id, 0 when idle. */
	#action = 0
	#actions = 0
	/** Bumped when a send the wallet never answered is given up on, so its late answer changes nothing. */
	#sendEpoch = 0

	constructor(env: BridgeEnv) {
		this.#env = env
	}

	/** Reads, approval if short, draft, signature, send, then the claim. */
	readonly confirm = (req: DepositRequest) => this.#act(["idle"], () => this.#start(req))

	readonly keepWaiting = () =>
		this.#act(["stuck"], async () => {
			const d = this.#draft
			if (!d?.l1TxHash) return this.#recheck()
			await this.#confirmMined(await this.#env.l1(), d)
		})

	/**
	 * Looks for the deposit on Ethereum. While the send is still awaiting the wallet, this gives up on that answer
	 * (the wallet may have broadcast and lost the reply): the request was recorded, so it is only ever looked for.
	 */
	readonly recheck = () => {
		if (this.store.get().step !== "sending" || !this.#draft?.submission) return this.#act(["stuck"], () => this.#recheck())
		this.#sendEpoch++
		this.#action = 0
		return this.#act(["sending"], () => this.#recheck())
	}

	readonly discard = () =>
		this.#act(["stuck"], async () => {
			if (!this.store.get().canDiscard) return
			this.#drop()
			this.store.set(IDLE)
		})

	readonly retryClaim = () => this.#act(["claim-failed", "paused"], () => this.#claimWhenReady())

	/** The only path to a wallet-paid claim: the user accepted it may link their account to this deposit. */
	readonly acceptFeeFallback = () => this.#act(["fee-fallback"], () => this.#claimNow("wallet-default"))

	readonly declineFeeFallback = () =>
		this.#act(["fee-fallback"], async () => {
			this.store.set({ step: "claim-failed", notice: `Not claimed yet. Retry once the fee sponsor is back. ${KEPT}` })
		})

	readonly reset = () => this.#act(["idle", "done"], async () => this.store.set(IDLE))

	async #act(from: DepositStep[], fn: () => Promise<void>): Promise<void> {
		if (this.#action !== 0 || !from.includes(this.store.get().step)) return
		const id = ++this.#actions
		this.#action = id
		try {
			await fn()
		} catch (e) {
			// A step that threw past its own handling (a wallet gone mid-action) keeps the step, with the reason.
			if (this.#action === id) this.store.set({ notice: explain(e) })
		} finally {
			// A superseded action must not release the one that replaced it.
			if (this.#action === id) this.#action = 0
		}
	}

	#back(e: unknown): void {
		this.store.set({ ...IDLE, notice: explain(e) })
	}

	#stuck(why: unknown, canDiscard = false): void {
		this.store.set({ step: "stuck", notice: typeof why === "string" ? why : `${explain(why)} ${KEPT}`, canDiscard })
	}

	#drop(): void {
		if (this.#draft) this.#env.inFlight.remove(this.#draft)
		this.#draft = null
		this.#ticket = null
	}

	async #start(req: DepositRequest): Promise<void> {
		const env = this.#env
		this.store.set({ ...IDLE, step: "checking", amount: req.amount, kind: req.kind })
		let l1: L1Ctx
		let recipient: AztecAddress
		let reads: { allowance: bigint; l1Now: bigint }
		try {
			l1 = await env.l1()
			recipient = env.l2().account
			if (!recipient.equals(AztecAddress.fromStringUnsafe(req.recipient))) {
				throw new Error("The Aztec account changed since you reviewed this deposit. Review it again.")
			}
			reads = await confirmReads(env, l1, req.amount)
		} catch (e) {
			return this.#back(e)
		}
		this.store.set({ recipient: recipient.toString() })
		if (reads.allowance < req.amount && !(await this.#approve(l1, req.amount))) return
		let d: DepositDraft
		try {
			d = await env.ops.prepareDeposit({ amount: req.amount, recipient, kind: req.kind }, env.manifest, () => reads.l1Now)
		} catch (e) {
			return this.#back(e)
		}
		// Registered before the signature: from here on the draft holds the only copy of the claim secret.
		this.#draft = d
		env.inFlight.add(d)
		await this.#send(l1, d)
	}

	async #approve(l1: L1Ctx, amount: bigint): Promise<boolean> {
		const m = this.#env.manifest
		this.store.set({ step: "approving" })
		try {
			await this.#env.ops.ensurePermit2Allowance({
				allowance: () => permit2Allowance(l1.publicClient, m, l1.account),
				approveMax: () =>
					l1.walletClient.writeContract({
						address: m.l1.usdc,
						abi: erc20Abi,
						functionName: "approve",
						args: [m.l1.permit2, maxUint256],
						account: signerOf(l1),
						chain: sendChain(l1, m.l1.chainId),
					}),
				waitReceipt: (hash) => awaitL1Receipt(l1.publicClient, hash),
				needed: amount,
				onStatus: (_, hash) => hash && this.store.set({ approvalTx: hash }),
			})
			return true
		} catch (e) {
			this.#back(e)
			return false
		}
	}

	async #send(l1: L1Ctx, d: DepositDraft): Promise<void> {
		const env = this.#env
		const epoch = this.#sendEpoch
		try {
			await env.ops.submitDeposit(d, l1, env.manifest, env.node, (stage) =>
				this.store.set({ step: stage === "signing" ? "signing" : "sending" }),
			)
		} catch (e) {
			if (epoch !== this.#sendEpoch) return
			// No submission recorded means nothing can have been broadcast: the draft, and its secret, are dropped.
			if (d.submission) return this.#stuck(e)
			this.#drop()
			return this.#back(e)
		}
		if (epoch !== this.#sendEpoch) return
		this.store.set({ l1TxHash: d.l1TxHash ?? null })
		await this.#confirmMined(l1, d)
	}

	async #confirmMined(l1: L1Ctx, d: DepositDraft): Promise<void> {
		this.store.set({ step: "confirming", notice: null })
		let t: ClaimTicket
		try {
			t = await this.#env.ops.confirmDeposit(d, l1, this.#env.manifest)
		} catch (e) {
			return this.#stuck(e)
		}
		await this.#claimWhenReady(t)
	}

	async #recheck(): Promise<void> {
		const d = this.#draft
		if (!d) return
		this.store.set({ step: "confirming", notice: null })
		let r: Reconciled
		try {
			r = await this.#env.ops.reconcileDeposit(d, await this.#env.l1(), this.#env.manifest)
		} catch (e) {
			return this.#stuck(e)
		}
		if (r === "pending") return this.#stuck(`Not found on Ethereum yet; it may still be on its way. Check again in a minute. ${KEPT}`)
		if (r === "not-deposited") {
			return this.#stuck(
				"This deposit never reached Ethereum and its signature has expired. Nothing was taken; you can discard it.",
				true,
			)
		}
		await this.#claimWhenReady(r)
	}

	async #claimWhenReady(t: ClaimTicket | null = this.#ticket): Promise<void> {
		if (!t) return
		const env = this.#env
		this.#ticket = t
		this.store.set({
			step: "waiting",
			notice: null,
			l1TxHash: t.draft.l1TxHash ?? null,
			minedAt: this.store.get().minedAt ?? Date.now(),
		})
		try {
			if (await env.ops.isBridgePaused(env.node, env.manifest)) return this.#paused()
			const l2 = this.#claimant(t)
			await env.ops.retryOnUnregistered(env.session, l2.wallet, () =>
				env.ops.waitClaimable(t, env.node, l2.wallet, env.manifest, l2.account, undefined, env.timing?.claim),
			)
			if (await env.ops.isBridgePaused(env.node, env.manifest)) return this.#paused()
		} catch (e) {
			return this.store.set({ step: "claim-failed", notice: `${explain(e)} ${KEPT}` })
		}
		await this.#claimNow()
	}

	/** A claim leaves only from the account the deposit names: from any other it would be a relayer's claim. */
	#claimant(t: ClaimTicket): L2Ctx {
		const l2 = this.#env.l2()
		const recipient = t.draft.intent.recipient
		if (!l2.account.equals(recipient)) {
			throw new Error(`Switch your Aztec wallet back to ${shortHex(recipient.toString())} to claim this deposit.`)
		}
		return l2
	}

	#paused(): void {
		this.store.set({
			step: "paused",
			notice: "The bridge is paused. Your deposit is safe and can be claimed once it resumes. Keep this tab open.",
		})
	}

	async #claimNow(fee?: FeeChoice): Promise<void> {
		const env = this.#env
		const t = this.#ticket
		if (!t) return
		this.store.set({ step: "claiming", notice: null })
		let outcome: ClaimOutcome
		try {
			const result = await env.gate.hold(() => {
				const l2 = this.#claimant(t)
				return env.ops.retryOnUnregistered(env.session, l2.wallet, () =>
					env.ops.claim(t, env.node, l2.wallet, env.manifest, { from: l2.account, fee }),
				)
			})
			outcome = result === "claimed" ? "claimed" : "already-claimed"
		} catch (e) {
			if (e instanceof SponsorUnavailableError) return this.store.set({ step: "fee-fallback", notice: e.message })
			return this.store.set({ step: "claim-failed", notice: `${explain(e)} ${KEPT}` })
		}
		await this.#awaitFinalized(t, outcome)
	}

	/** A claim can still be pruned until final: the secret goes only once the claim is finalized. */
	async #awaitFinalized(t: ClaimTicket, outcome: ClaimOutcome): Promise<void> {
		const env = this.#env
		this.store.set({ step: "finalizing", notice: null })
		if ((await env.ops.waitClaimFinalized(t, env.node, env.manifest, env.timing?.finalized)) === "dropped") {
			return this.#claimWhenReady(t)
		}
		this.#drop()
		this.store.set({ step: "done", outcome, notice: null })
	}
}
