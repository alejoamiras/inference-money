/**
 * Payment requests on the merchant token: open one, check its stamp, and pay it at most once from one client.
 *
 * A request is a partial note's commitment. Completion is not single-use, and the recipient discovers only the first
 * completion (aztec-nr `uint_note.nr`), so a second payment into one request lands on chain and is lost. `payRequest`
 * therefore refuses a request completed on chain, or one this client has paid or is paying, through one
 * {@link PaymentRecord} per request in an injected {@link PaymentStore}:
 * - `reserved`, under the store's lock before anything is simulated; a failure before the send releases it;
 * - `sent`, written by the {@link PaymentGate} between proving and the node receiving the tx, with the tx's hash and
 *   expiry. Only the chain moves it on: to `paid` once the tx is finalized, or released once the tx reverted or the
 *   chain passed its expiry without it, so an uncertain send never allows a second one;
 * - `paid`.
 * Clients that share no store (two devices) can still both pay; the on-chain check only narrows that window.
 */
import type { AztecAddress } from "@aztec-labs/aztec.js/addresses"
import { Contract, NO_WAIT } from "@aztec-labs/aztec.js/contracts"
import type { FeePaymentMethod } from "@aztec-labs/aztec.js/fee"
import type { Fr } from "@aztec-labs/aztec.js/fields"
import { type AztecNode, waitForTx } from "@aztec-labs/aztec.js/node"
import { TxHash, TxStatus } from "@aztec-labs/aztec.js/tx"
import type { Wallet } from "@aztec-labs/aztec.js/wallet"
import { poseidon2HashWithSeparator } from "@aztec-labs/foundation/crypto/sync"
import { SiloedTag, Tag } from "@aztec-labs/stdlib/logs"
import { MerkleTreeId } from "@aztec-labs/stdlib/trees"
import type { OffchainEffect, Tx } from "@aztec-labs/stdlib/tx"
import { tokenArtifact } from "./artifacts"
import { L2_DONE } from "./claim"
import { type MerchantList, merchantSide, paymentSide, Side, sideCapsule, withFreshList } from "./merchants"
import { TOKEN_REFUSALS } from "./rules"
import { REQUEST_OPENED_EFFECT, siloedRequestMarks } from "./stamp"

/** aztec-nr's DOM_SEP__NOTE_COMPLETION_LOG_TAG (`note/partial_note.nr`): tags the log every completion emits. */
const DOM_SEP__NOTE_COMPLETION_LOG_TAG = 3372669888
/** The kernel's cap on a tx's lifetime (MAX_TX_LIFETIME): no tx outlives its anchor by more. */
const MAX_TX_LIFETIME = 86_400n
/** How long a reservation blocks other clients before it counts as abandoned; the gate refuses a superseded one. */
export const RESERVATION_TTL_MS = 10 * 60_000

export type PaymentRecord =
	| { state: "reserved"; owner: string; since: number }
	| { state: "sent"; owner: string; txHash: string; expiresAt: string }
	| { state: "paid"; txHash: string }

/** One record per request, shared by every tab or process that pays from this client. */
export interface PaymentStore {
	/** Runs `fn` holding the exclusive lock for `key`; every read-modify-write of a record runs inside one. */
	locked<T>(key: string, fn: () => Promise<T>): Promise<T>
	get(key: string): Promise<PaymentRecord | undefined>
	put(key: string, record: PaymentRecord | undefined): Promise<void>
}

/** A store for one process (a CLI run, tests): records in memory, one promise-chain lock per key. */
export function memoryPaymentStore(): PaymentStore {
	const records = new Map<string, PaymentRecord>()
	const tails = new Map<string, Promise<unknown>>()
	return {
		locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
			const run = (tails.get(key) ?? Promise.resolve()).then(fn)
			tails.set(
				key,
				run.catch(() => undefined),
			)
			return run
		},
		get: async (key) => records.get(key),
		put: async (key, record) => {
			if (record) records.set(key, record)
			else records.delete(key)
		},
	}
}

export type PaymentRefusal = "paid" | "in-flight" | "completed-on-chain"

const REFUSAL_TEXT: Record<PaymentRefusal, string> = {
	paid: "This request is already paid.",
	"in-flight": "This request is already being paid; wait for that payment, or open a new request.",
	"completed-on-chain": "This request was already paid on chain; a second payment would never reach its recipient.",
}

/** `payRequest` refused before anything was sent. */
export class PaymentRefusedError extends Error {
	constructor(
		readonly reason: PaymentRefusal,
		readonly txHash?: string,
	) {
		super(txHash ? `${REFUSAL_TEXT[reason]} (tx ${txHash})` : REFUSAL_TEXT[reason])
		this.name = "PaymentRefusedError"
	}
}

export type PaymentNode = Pick<
	AztecNode,
	"sendTx" | "getTxReceipt" | "getBlockData" | "findLeavesIndexes" | "getPrivateLogsByTags" | "getPublicLogsByTags"
>

export const paymentKey = (token: AztecAddress, commitment: Fr) => `${token.toString()}:${commitment.toString()}`

const completionTag = (commitment: Fr) => new Tag(poseidon2HashWithSeparator([commitment], DOM_SEP__NOTE_COMPLETION_LOG_TAG))

/** The first field of the private log a private payment into `commitment` emits, as the node indexes it. */
export async function siloedCompletionTag(token: AztecAddress, commitment: Fr): Promise<Fr> {
	return (await SiloedTag.computeFromTagAndApp(completionTag(commitment), token)).value
}

/** How many times `commitment` was completed on chain, privately or publicly; its recipient discovers only the first. */
export async function completionCount(
	node: Pick<AztecNode, "getPrivateLogsByTags" | "getPublicLogsByTags">,
	token: AztecAddress,
	commitment: Fr,
): Promise<number> {
	const tag = completionTag(commitment)
	const [[privateLogs], [publicLogs]] = await Promise.all([
		node.getPrivateLogsByTags({ tags: [await SiloedTag.computeFromTagAndApp(tag, token)] }),
		node.getPublicLogsByTags({ contractAddress: token, tags: [tag] }),
	])
	return (privateLogs?.length ?? 0) + (publicLogs?.length ?? 0)
}

/** Whether `commitment` was opened for a merchant (its stamp exists) by the node's latest block. */
export async function isStamped(node: Pick<AztecNode, "findLeavesIndexes">, token: AztecAddress, commitment: Fr): Promise<boolean> {
	const { stamp } = await siloedRequestMarks(token, commitment)
	const [found] = await node.findLeavesIndexes("latest", MerkleTreeId.NULLIFIER_TREE, [stamp])
	return found !== undefined
}

/** The commitment an opening handed its sender as `[REQUEST_OPENED_EFFECT, c]`; throws unless the tx opened exactly one. */
export function openedCommitment(effects: readonly OffchainEffect[], token: AztecAddress): Fr {
	const opened = effects.filter((e) => e.contractAddress.equals(token) && e.data.length === 2 && e.data[0]!.equals(REQUEST_OPENED_EFFECT))
	if (opened.length !== 1) throw new Error(`Expected the tx to open one request, but it opened ${opened.length}.`)
	return opened[0]!.data[1]!
}

type SendFee = { paymentMethod: FeePaymentMethod } | undefined

export interface ListOptions {
	list: MerchantList
	/** Re-syncs the list; a call refused on a merchant rule is retried once on the fresh one. */
	resync?: () => Promise<MerchantList>
	fee?: SendFee
}

export interface RequestIntent {
	/** The account sending the opening tx: the recipient itself, or a payer opening one for it. */
	from: AztecAddress
	/** The account the payment reaches. */
	to: AztecAddress
	/** The only account that can pay into it. */
	completer: AztecAddress
}

/**
 * Opens a request and returns once it is checkpointed, when a private payment can prove its stamp. Refused before
 * proving unless the recipient or the creator is a merchant; a merchant recipient's request is stamped.
 */
export async function openRequest(
	wallet: Wallet,
	node: Pick<AztecNode, "getTxReceipt">,
	token: AztecAddress,
	r: RequestIntent,
	opts: ListOptions,
): Promise<{ commitment: Fr; txHash: TxHash }> {
	const sent = await withFreshList(opts.list, opts.resync, async (list) => {
		const side = merchantSide(list, r.to, r.from, true)
		if (side === Side.Neither) throw new Error(TOKEN_REFUSALS.request)
		const open = Contract.at(token, tokenArtifact, wallet).methods.initialize_transfer_commitment!(r.to, r.completer)
		return open.with({ capsules: [sideCapsule(token, side)] }).send({ from: r.from, fee: opts.fee, wait: NO_WAIT })
	})
	const commitment = openedCommitment(sent.offchainEffects, token)
	await waitForTx(node as AztecNode, sent.txHash, L2_DONE)
	return { commitment, txHash: sent.txHash }
}

interface Expected {
	owner: string
	commitment: Fr
	siloedTag: Fr
}

// A private payment's completion log carries the request's siloed tag; a public one passes the commitment as calldata.
function pays(tx: Tx, e: Expected): boolean {
	if (tx.data.getNonEmptyPrivateLogs().some((log) => log.fields[0].equals(e.siloedTag))) return true
	return tx.publicFunctionCalldata.some((call) => call.values.some((v) => v.equals(e.commitment)))
}

async function latestTimestamp(node: Pick<AztecNode, "getBlockData">): Promise<bigint> {
	const data = await node.getBlockData("latest")
	if (!data) throw new Error("The node returned no latest block.")
	return data.header.globalVariables.timestamp
}

/** What a `sent` record becomes on the node's current view; undefined releases it. */
async function settle(r: Extract<PaymentRecord, { state: "sent" }>, node: PaymentNode): Promise<PaymentRecord | undefined> {
	const receipt = await node.getTxReceipt(TxHash.fromString(r.txHash))
	if (receipt.isMined()) {
		if (receipt.hasExecutionReverted()) return undefined
		return receipt.status === TxStatus.FINALIZED ? { state: "paid", txHash: r.txHash } : r
	}
	if (receipt.isPending()) return r
	return (await latestTimestamp(node)) > BigInt(r.expiresAt) ? undefined : r
}

async function refreshed(r: PaymentRecord | undefined, node: PaymentNode, now: number): Promise<PaymentRecord | undefined> {
	if (r?.state === "sent") return settle(r, node)
	if (r?.state === "reserved" && now - r.since > RESERVATION_TTL_MS) return undefined
	return r
}

function refusalFor(r: PaymentRecord): PaymentRefusedError {
	if (r.state === "paid") return new PaymentRefusedError("paid", r.txHash)
	return new PaymentRefusedError("in-flight", r.state === "sent" ? r.txHash : undefined)
}

/**
 * The payment records plus a node wrapper: a wallet built on {@link PaymentGate.node} has every payment tx recorded
 * as `sent` (hash and expiry) after proving and before the node receives it, and a superseded reservation never
 * reaches the node.
 */
export class PaymentGate {
	readonly node: AztecNode
	private readonly expected = new Map<string, Expected>()

	constructor(
		node: AztecNode,
		readonly store: PaymentStore,
		private readonly now: () => number = Date.now,
	) {
		this.node = new Proxy(node, {
			get: (target, key, receiver) =>
				key === "sendTx" ? (tx: Tx) => this.recordThenSend(target, tx) : Reflect.get(target, key, receiver),
		})
	}

	/** The request's record as the chain now settles it (`paid`, released, or unchanged). */
	status(key: string): Promise<PaymentRecord | undefined> {
		return this.store.locked(key, async () => {
			const current = await this.store.get(key)
			const next = await refreshed(current, this.node, this.now())
			if (next !== current) await this.store.put(key, next)
			return next
		})
	}

	/** Claims `key` for one payment attempt, or throws {@link PaymentRefusedError}; returns the attempt's owner id. */
	reserve(key: string): Promise<string> {
		return this.store.locked(key, async () => {
			const current = await refreshed(await this.store.get(key), this.node, this.now())
			if (current) {
				await this.store.put(key, current)
				throw refusalFor(current)
			}
			const owner = crypto.randomUUID()
			await this.store.put(key, { state: "reserved", owner, since: this.now() })
			return owner
		})
	}

	/** Releases `owner`'s reservation if nothing was sent under it. */
	releaseUnsent(key: string, owner: string): Promise<void> {
		return this.store.locked(key, async () => {
			const r = await this.store.get(key)
			if (r?.state === "reserved" && r.owner === owner) await this.store.put(key, undefined)
		})
	}

	/** Runs `send` with `key`'s payment expected at the node; any tx it sends that pays `commitment` is recorded first. */
	async sending(key: string, owner: string, token: AztecAddress, commitment: Fr, send: () => Promise<TxHash>): Promise<TxHash> {
		const siloedTag = await siloedCompletionTag(token, commitment)
		this.expected.set(key, { owner, commitment, siloedTag })
		try {
			const txHash = await send()
			await this.confirmSent(key, owner, txHash)
			return txHash
		} finally {
			this.expected.delete(key)
		}
	}

	private async recordThenSend(target: AztecNode, tx: Tx): Promise<void> {
		for (const [key, e] of this.expected) {
			if (pays(tx, e)) await this.recordSent(key, e.owner, tx.getTxHash().toString(), tx.data.expirationTimestamp)
		}
		return target.sendTx(tx)
	}

	private recordSent(key: string, owner: string, txHash: string, expiresAt: bigint): Promise<void> {
		return this.store.locked(key, async () => {
			const r = await this.store.get(key)
			if (r?.state !== "reserved" || r.owner !== owner) throw r ? refusalFor(r) : new PaymentRefusedError("in-flight")
			await this.store.put(key, { state: "sent", owner, txHash, expiresAt: expiresAt.toString() })
		})
	}

	// A wallet not built on `node` sends unseen: the tx went out, so it is recorded with the longest expiry it can have.
	private confirmSent(key: string, owner: string, txHash: TxHash): Promise<void> {
		return this.store.locked(key, async () => {
			const r = await this.store.get(key)
			if (r?.state === "sent" && r.txHash === txHash.toString()) return
			const expiresAt = (await latestTimestamp(this.node)) + MAX_TX_LIFETIME
			await this.store.put(key, { state: "sent", owner, txHash: txHash.toString(), expiresAt: expiresAt.toString() })
		})
	}
}

export interface PaymentIntent {
	from: AztecAddress
	commitment: Fr
	amount: bigint
	/** From the payer's private balance, or its public one. */
	kind: "private" | "public"
}

function paymentCall(wallet: Wallet, token: AztecAddress, p: PaymentIntent, side: Side) {
	const methods = Contract.at(token, tokenArtifact, wallet).methods
	if (p.kind === "public") return methods.transfer_public_to_commitment!(p.from, p.commitment, p.amount, 0)
	return methods.transfer_private_to_commitment!(p.from, p.commitment, p.amount, 0).with({ capsules: [sideCapsule(token, side)] })
}

/**
 * Pays `amount` into a request through `gate`, whose node the wallet must be built on. Refused before anything is
 * proven when the request is completed on chain, paid or being paid from this client (see {@link PaymentGate}), or
 * neither stamped nor paid by a merchant. Returns once the payment is checkpointed; its record turns `paid` when
 * finalized ({@link PaymentGate.status}).
 */
export async function payRequest(
	gate: PaymentGate,
	wallet: Wallet,
	token: AztecAddress,
	p: PaymentIntent,
	opts: ListOptions,
): Promise<TxHash> {
	const key = paymentKey(token, p.commitment)
	const owner = await gate.reserve(key)
	try {
		if ((await completionCount(gate.node, token, p.commitment)) > 0) throw new PaymentRefusedError("completed-on-chain")
		const stamped = await isStamped(gate.node, token, p.commitment)
		const txHash = await withFreshList(opts.list, opts.resync, (list) => {
			const side = paymentSide(list, stamped, p.from)
			if (side === Side.Neither) throw new Error(TOKEN_REFUSALS.payment)
			const call = paymentCall(wallet, token, p, side)
			return gate.sending(
				key,
				owner,
				token,
				p.commitment,
				async () => (await call.send({ from: p.from, fee: opts.fee, wait: NO_WAIT })).txHash,
			)
		})
		await waitForTx(gate.node, txHash, { ...L2_DONE, dontThrowOnRevert: true })
		if (!(await gate.status(key)))
			throw new Error(`The payment ${txHash} was rejected on Aztec, so nothing was paid; it can be retried.`)
		return txHash
	} finally {
		await gate.releaseUnsent(key, owner)
	}
}
