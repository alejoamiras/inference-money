import { Fr } from "@aztec/aztec.js/fields"
import { computeL2ToL1MembershipWitness } from "@aztec/stdlib/messaging"
import {
	BaseError,
	bytesToHex,
	ContractFunctionRevertedError,
	type Hex,
	isAddressEqual,
	type PublicClient,
	parseEventLogs,
	TransactionNotFoundError,
	type TransactionReceipt,
} from "viem"
import { OUTBOX_ABI, TOKEN_PORTAL_ABI } from "./abi"
import { type ExitNode, type ExitTicket, expectedExitMessage } from "./exit"
import { type AwaitL1ReceiptOptions, awaitL1Receipt } from "./l1-receipt"
import type { BridgeManifest } from "./manifest"
import { assertSigningContext } from "./network"
import type { OutboxReader } from "./outbox"
import { type L1Ctx, type StageSink, sendChain, signerOf } from "./types"

/**
 * The Outbox membership proof `TokenPortal.withdraw` takes. Only one {@link buildWithdrawProof} returned is accepted,
 * and only for the exit it was built for: the Outbox checks a leaf's consumed bit before its membership, so a proof of
 * another, already-withdrawn leaf would read as this exit withdrawn.
 */
export interface OutboxProof {
	readonly epoch: bigint
	readonly numCheckpointsInEpoch: bigint
	readonly leafIndex: bigint
	readonly path: readonly Hex[]
}

/** This occurrence was already withdrawn on L1 (other identical occurrences in the tx are unaffected). */
export class AlreadyWithdrawnError extends Error {
	constructor(options?: ErrorOptions) {
		super("This withdrawal was already completed on Ethereum.", options)
		this.name = "AlreadyWithdrawnError"
	}
}

/** The node's view of the epoch and the L1 Outbox's disagree; rebuilding from newer proven state usually resolves it. */
export class StaleProofError extends Error {
	constructor(options?: ErrorOptions) {
		super("The withdrawal proof does not match the Ethereum Outbox. The withdrawal is kept; retry shortly.", options)
		this.name = "StaleProofError"
	}
}

export const MAX_PROOF_REBUILDS = 3
const ROOT_MISMATCH = /does not match Outbox/
const STALE_PROOF_REVERTS = new Set([
	"MerkleLib__InvalidRoot",
	"MerkleLib__InvalidIndexForPathLength",
	"Outbox__NothingToConsumeAtEpoch",
	"Outbox__InvalidNumCheckpointsInEpoch",
	"Outbox__LeafIndexOutOfBounds",
])

type Sleep = (ms: number) => Promise<void>
const realSleep: Sleep = (ms) => new Promise<void>((r) => setTimeout(r, ms))

/** Each built proof, frozen, mapped to the exit it proves; a copy or a hand-made proof is in no entry. */
const provenExit = new WeakMap<OutboxProof, string>()
const exitKey = (t: ExitTicket) => `${t.messageHash.toLowerCase()}:${t.l2TxHash.toString()}:${t.messageIndexInTx}`

/**
 * The proof for the ticket's message, or "pending" while the Outbox holds no root covering it yet. A root mismatch
 * (node and L1 disagree mid-proof) is rebuilt from current state, at most {@link MAX_PROOF_REBUILDS} times.
 */
export async function buildWithdrawProof(
	t: ExitTicket,
	node: ExitNode,
	outbox: OutboxReader,
	opts: { sleep?: Sleep; retryMs?: number } = {},
): Promise<OutboxProof | "pending"> {
	// Read once, before any await: the proof is recorded for exactly the exit it was computed from.
	const { messageHash, l2TxHash, messageIndexInTx } = t
	const key = exitKey(t)
	const message = Fr.fromHexString(messageHash)
	let lastError: unknown
	for (let attempt = 1; attempt <= MAX_PROOF_REBUILDS; attempt++) {
		try {
			const w = await computeL2ToL1MembershipWitness(node, outbox, message, l2TxHash, messageIndexInTx)
			if (!w) return "pending"
			const proof: OutboxProof = Object.freeze({
				epoch: BigInt(w.epochNumber),
				numCheckpointsInEpoch: BigInt(w.numCheckpointsInEpoch),
				leafIndex: w.leafIndex,
				path: Object.freeze(w.siblingPath.toBufferArray().map((b) => bytesToHex(b))),
			})
			provenExit.set(proof, key)
			return proof
		} catch (e) {
			if (!(e instanceof Error && ROOT_MISMATCH.test(e.message))) throw e
			lastError = e
			await (opts.sleep ?? realSleep)(opts.retryMs ?? 10_000)
		}
	}
	throw new StaleProofError({ cause: lastError })
}

export interface WaitWithdrawableOptions {
	/** Default 60 min: epochs prove on the order of tens of minutes. */
	timeoutMs?: number
	pollMs?: number
	sleep?: Sleep
	now?: () => number
}

/** Polls until the exit's epoch is proven on L1 and returns its proof; timing out keeps the ticket for a later retry. */
export async function waitWithdrawable(
	t: ExitTicket,
	node: ExitNode,
	outbox: OutboxReader,
	on?: StageSink<"proving">,
	opts: WaitWithdrawableOptions = {},
): Promise<OutboxProof> {
	const now = opts.now ?? Date.now
	const sleep = opts.sleep ?? realSleep
	const deadline = now() + (opts.timeoutMs ?? 60 * 60_000)
	while (true) {
		const proof = await buildWithdrawProof(t, node, outbox, { sleep })
		if (proof !== "pending") return proof
		if (now() >= deadline) throw new Error("The withdrawal is not proven on Ethereum yet. It is kept; check again later.")
		on?.("proving")
		await sleep(opts.pollMs ?? 30_000)
	}
}

function revertName(e: unknown): string | undefined {
	const reverted = e instanceof BaseError ? e.walk((c) => c instanceof ContractFunctionRevertedError) : undefined
	return reverted instanceof ContractFunctionRevertedError ? reverted.data?.errorName : undefined
}

/**
 * Only the Outbox's own event for this leaf proves the withdrawal: viem follows a replaced tx to its replacement's
 * receipt, a cancellation included, and a successful self-transfer consumes nothing.
 */
function assertConsumedIn(receipt: TransactionReceipt, t: ExitTicket, p: OutboxProof, m: BridgeManifest): Hex {
	const leafId = 2n ** BigInt(p.path.length) + p.leafIndex
	const events = parseEventLogs({
		abi: OUTBOX_ABI,
		eventName: "MessageConsumed",
		logs: receipt.logs.filter((l) => isAddressEqual(l.address, m.l1.outbox)),
	})
	const hit = events.some(
		({ args }) => args.messageHash.toLowerCase() === t.messageHash.toLowerCase() && args.epoch === p.epoch && args.leafId === leafId,
	)
	if (!hit) {
		throw new Error(
			`Ethereum transaction ${receipt.transactionHash} mined without this withdrawal (replaced or cancelled). It is kept; retry.`,
		)
	}
	return receipt.transactionHash
}

/** The proof was built for this exit, and the exit's message is the one its recipient and amount produce. */
async function assertProofFor(t: ExitTicket, p: OutboxProof, m: BridgeManifest): Promise<void> {
	if (provenExit.get(p) !== exitKey(t)) throw new Error("This proof was not built for this withdrawal.")
	const message = await expectedExitMessage(t.recipient, t.amount, m)
	if (message.toString() !== t.messageHash.toLowerCase())
		throw new Error("The withdrawal's recipient or amount does not match its message.")
}

/**
 * Simulates, then sends `TokenPortal.withdraw`; the recipient is fixed by the message, so any account may submit it.
 * Returns the hash of the transaction that mined the withdrawal, which differs from the sent one after a speed-up.
 * The ticket is copied on entry: what is checked is what is sent, whatever the caller changes meanwhile.
 */
export async function withdrawOnL1(
	ticket: ExitTicket,
	p: OutboxProof,
	l1: L1Ctx,
	m: BridgeManifest,
	opts: { receipt?: AwaitL1ReceiptOptions } = {},
): Promise<Hex> {
	const t: ExitTicket = { ...ticket }
	await assertProofFor(t, p, m)
	const expected = { l1Account: l1.account }
	await assertSigningContext(l1, null, m, expected)
	const call = {
		address: m.l1.portal,
		abi: TOKEN_PORTAL_ABI,
		functionName: "withdraw",
		args: [t.recipient, t.amount, false, p.epoch, p.numCheckpointsInEpoch, p.leafIndex, [...p.path]],
		account: signerOf(l1),
	} as const
	try {
		await l1.publicClient.simulateContract(call)
	} catch (e) {
		const name = revertName(e)
		if (name === "Outbox__AlreadyNullified") throw new AlreadyWithdrawnError({ cause: e })
		if (name && STALE_PROOF_REVERTS.has(name)) throw new StaleProofError({ cause: e })
		throw e
	}
	await assertSigningContext(l1, null, m, expected)
	const hash = await l1.walletClient.writeContract({ ...call, chain: sendChain(l1, m.l1.chainId) })
	return assertConsumedIn(await awaitWithdrawReceipt(l1.publicClient, hash, opts.receipt), t, p, m)
}

/**
 * A withdraw is never given up on while the node still holds it: a caller that stopped waiting would release its lock
 * and let a second withdraw go out beside the first. Only a tx the node no longer knows (dropped or replaced) throws.
 */
async function awaitWithdrawReceipt(pub: PublicClient, hash: Hex, opts?: AwaitL1ReceiptOptions): Promise<TransactionReceipt> {
	for (;;) {
		try {
			return await awaitL1Receipt(pub, hash, opts)
		} catch (e) {
			if (e instanceof Error && /reverted on-chain/.test(e.message)) throw e
			if (!(await stillKnown(pub, hash))) {
				throw new Error(`The withdrawal ${hash} left the network without confirming. Nothing was paid; send it again.`, {
					cause: e,
				})
			}
		}
	}
}

/** An unreadable answer counts as known: giving up is the step that can double-send. */
async function stillKnown(pub: PublicClient, hash: Hex): Promise<boolean> {
	try {
		await pub.getTransaction({ hash })
		return true
	} catch (e) {
		return !(e instanceof TransactionNotFoundError)
	}
}

/** Waits for the proof and withdraws, rebuilding a proof the Outbox rejects as stale at most {@link MAX_PROOF_REBUILDS} times. */
export async function finishWithdrawal(
	t: ExitTicket,
	node: ExitNode,
	outbox: OutboxReader,
	l1: L1Ctx,
	m: BridgeManifest,
	on?: StageSink<"proving" | "withdrawing">,
	opts: WaitWithdrawableOptions = {},
): Promise<Hex> {
	for (let attempt = 1; ; attempt++) {
		const proof = await waitWithdrawable(t, node, outbox, on, opts)
		on?.("withdrawing")
		try {
			return await withdrawOnL1(t, proof, l1, m)
		} catch (e) {
			if (!(e instanceof StaleProofError) || attempt >= MAX_PROOF_REBUILDS) throw e
		}
	}
}
