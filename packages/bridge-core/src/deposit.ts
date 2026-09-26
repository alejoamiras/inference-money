import type { AztecAddress } from "@aztec/aztec.js/addresses"
import { Fr } from "@aztec/aztec.js/fields"
import { computeSecretHash } from "@aztec/stdlib/hash"
import { type Address, getAbiItem, type Hex, isAddressEqual, type Log, type PublicClient, pad, parseEventLogs } from "viem"
import { PERMIT2_DEPOSIT_ROUTER_ABI } from "./abi"
import { deriveClaimSecret } from "./claim-secret"
import { isUserRejection } from "./errors"
import { type AwaitL1ReceiptOptions, awaitL1Receipt } from "./l1-receipt"
import type { BridgeManifest } from "./manifest"
import { assertSigningContext } from "./network"
import { type DepositTypedData, type DepositWitness, depositPermitTypedData, PERMIT_DEADLINE_SECONDS, randomPermitNonce } from "./permit2"
import { type L1Ctx, MAX_L2_AMOUNT, type StageSink } from "./types"

export type DepositKind = "public" | "private"

export interface DepositIntent {
	amount: bigint
	recipient: AztecAddress
	kind: DepositKind
}

/**
 * Created before any signature and the single owner of the claim secret; in memory only. `submission` is recorded
 * before the send request, so a draft that has one may have been broadcast and is only ever reconciled, never re-sent.
 */
export interface DepositDraft {
	intent: DepositIntent
	/** Public: the message secret. Private: the claim salt; `claim_private` derives the secret from it and the recipient. */
	secretOrSalt: Fr
	secretHash: Fr
	witness: DepositWitness
	typedData: DepositTypedData
	/** `fromBlock` is the finalized block before the send: a reorg can re-mine the deposit below the tip seen then. */
	submission?: { account: Address; chainId: number; fromBlock: bigint }
	l1TxHash?: Hex
}

export interface ClaimTicket {
	draft: DepositDraft
	/** The Inbox message key. */
	messageHash: Hex
	leafIndex: bigint
}

/** `not-deposited` only after an error-free scan through a finalized block past the permit deadline. */
export type Reconciled = ClaimTicket | "pending" | "not-deposited"

export type DepositStage = "signing" | "depositing" | "confirming"

const DEPOSIT_EVENT = getAbiItem({ abi: PERMIT2_DEPOSIT_ROUTER_ABI, name: "Deposit" })
const ZERO_WORD = pad("0x0")
/** Blocks per `eth_getLogs` call; providers cap the range. */
export const LOG_SCAN_CHUNK = 5_000n

/** The router's intent rules plus what makes an L2 claim impossible (a zero or off-curve recipient). */
export async function assertDepositIntent(i: DepositIntent): Promise<void> {
	if (i.amount <= 0n) throw new Error("The amount must be positive.")
	if (i.amount > MAX_L2_AMOUNT) throw new Error("The amount exceeds what the L2 token can hold.")
	if (i.recipient.isZero()) throw new Error("The Aztec recipient must not be the zero address.")
	if (!(await i.recipient.isValid())) throw new Error("The Aztec recipient is not a valid Aztec address.")
}

export async function prepareDeposit(i: DepositIntent, m: BridgeManifest, now: () => bigint): Promise<DepositDraft> {
	await assertDepositIntent(i)
	const isPrivate = i.kind === "private"
	const secretOrSalt = Fr.random()
	const secretHash = await computeSecretHash(isPrivate ? deriveClaimSecret(secretOrSalt, i.recipient) : secretOrSalt)
	const witness: DepositWitness = {
		aztecRecipient: isPrivate ? ZERO_WORD : (i.recipient.toString() as Hex),
		secretHash: secretHash.toString() as Hex,
		isPrivate,
	}
	const permit = {
		token: m.l1.usdc,
		amount: i.amount,
		spender: m.l1.router,
		nonce: randomPermitNonce(),
		deadline: now() + PERMIT_DEADLINE_SECONDS,
	}
	return { intent: i, secretOrSalt, secretHash, witness, typedData: depositPermitTypedData(permit, witness, m.l1.permit2, m.l1.chainId) }
}

/** Signs and sends the deposit; `d.l1TxHash` is set the moment the wallet returns it. */
export async function submitDeposit(d: DepositDraft, l1: L1Ctx, m: BridgeManifest, on?: StageSink<DepositStage>): Promise<Hex> {
	if (d.submission) throw new Error("This deposit was already sent. Re-check it instead of sending it again.")
	const expected = { l1Account: l1.account }
	await assertSigningContext(l1, null, m, expected)
	on?.("signing")
	const signature = await l1.walletClient.signTypedData({ account: l1.account, ...d.typedData })
	await assertSigningContext(l1, null, m, expected)
	const finalized = await l1.publicClient.getBlock({ blockTag: "finalized" })
	d.submission = { account: l1.account, chainId: m.l1.chainId, fromBlock: finalized.number }
	on?.("depositing")
	const { message } = d.typedData
	try {
		d.l1TxHash = await l1.walletClient.writeContract({
			address: m.l1.router,
			abi: PERMIT2_DEPOSIT_ROUTER_ABI,
			functionName: "deposit",
			args: [
				message.permitted.amount,
				d.witness.aztecRecipient,
				d.witness.secretHash,
				d.witness.isPrivate,
				message.nonce,
				message.deadline,
				signature,
			],
			account: l1.account,
			chain: l1.walletClient.chain ?? null,
		})
	} catch (e) {
		// An explicit refusal means nothing was broadcast; any other failure may have been, so the draft stays submitted.
		if (isUserRejection(e)) d.submission = undefined
		throw e
	}
	return d.l1TxHash
}

type DepositArgs = { depositor: Address; aztecRecipient: Hex; key: Hex; index: bigint; amount: bigint; secretHash: Hex; isPrivate: boolean }

function isThisDeposit(a: DepositArgs, d: DepositDraft): boolean {
	const s = d.submission
	return (
		s !== undefined &&
		isAddressEqual(a.depositor, s.account) &&
		a.secretHash.toLowerCase() === d.witness.secretHash.toLowerCase() &&
		a.aztecRecipient.toLowerCase() === d.witness.aztecRecipient.toLowerCase() &&
		a.amount === d.intent.amount &&
		a.isPrivate === d.witness.isPrivate
	)
}

/**
 * The claim ticket from a mined deposit's receipt. Only a log emitted by the manifest router counts, and there must be
 * exactly one: the token runs arbitrary code during the Permit2 pull and can emit a same-signature event.
 */
export function ticketFromReceiptLogs(d: DepositDraft, logs: Log[], m: BridgeManifest): ClaimTicket {
	const router = logs.filter((l) => isAddressEqual(l.address, m.l1.router))
	const events = parseEventLogs({ abi: PERMIT2_DEPOSIT_ROUTER_ABI, eventName: "Deposit", logs: router, strict: true })
	if (events.length !== 1) throw new Error(`Expected exactly one router Deposit event in the receipt, found ${events.length}.`)
	const [event] = events
	if (!event || !isThisDeposit(event.args, d)) throw new Error("The mined Deposit event does not match this deposit.")
	return { draft: d, messageHash: event.args.key, leafIndex: event.args.index }
}

/** Waits for the sent deposit to mine. A revert or timeout throws with the draft untouched, so it can be re-checked. */
export async function confirmDeposit(
	d: DepositDraft,
	l1: L1Ctx,
	m: BridgeManifest,
	on?: StageSink<DepositStage>,
	opts?: AwaitL1ReceiptOptions,
): Promise<ClaimTicket> {
	if (!d.l1TxHash) throw new Error("This deposit has no transaction hash yet. Re-check it instead.")
	on?.("confirming")
	const receipt = await awaitL1Receipt(l1.publicClient, d.l1TxHash, opts)
	return ticketFromReceiptLogs(d, receipt.logs, m)
}

async function ticketByHash(d: DepositDraft, pub: PublicClient, m: BridgeManifest): Promise<ClaimTicket | undefined> {
	if (!d.l1TxHash) return undefined
	try {
		const receipt = await pub.getTransactionReceipt({ hash: d.l1TxHash })
		return receipt.status === "success" ? ticketFromReceiptLogs(d, receipt.logs, m) : undefined
	} catch {
		return undefined
	}
}

async function scanForDeposit(
	d: DepositDraft,
	pub: PublicClient,
	m: BridgeManifest,
	from: bigint,
	to: bigint,
): Promise<ClaimTicket | undefined> {
	const account = d.submission?.account
	for (let start = from; start <= to; start += LOG_SCAN_CHUNK) {
		const end = start + LOG_SCAN_CHUNK - 1n < to ? start + LOG_SCAN_CHUNK - 1n : to
		const logs = await pub.getLogs({
			address: m.l1.router,
			event: DEPOSIT_EVENT,
			args: { depositor: account },
			fromBlock: start,
			toBlock: end,
			strict: true,
		})
		const hit = logs.find((l) => isAddressEqual(l.address, m.l1.router) && isThisDeposit(l.args, d))
		if (hit) return { draft: d, messageHash: hit.args.key, leafIndex: hit.args.index }
	}
	return undefined
}

/**
 * Finds a sent deposit without ever re-sending it: by tx hash first, and whenever that does not establish it (unknown,
 * dropped or replaced hash, lost wallet response) by scanning the router's `Deposit` logs for this draft's depositor
 * and secret hash, from the pre-send finalized block. Any RPC failure reads as "pending".
 */
export async function reconcileDeposit(d: DepositDraft, l1: L1Ctx, m: BridgeManifest): Promise<Reconciled> {
	if (!d.submission) return "not-deposited"
	const pub = l1.publicClient
	try {
		const byHash = await ticketByHash(d, pub, m)
		if (byHash) return byHash
		const [latest, finalized] = await Promise.all([pub.getBlockNumber(), pub.getBlock({ blockTag: "finalized" })])
		const found = await scanForDeposit(d, pub, m, d.submission.fromBlock, latest)
		if (found) return found
		// Timestamps only grow, so once a finalized block is past the deadline Permit2 rejects any later inclusion.
		return finalized.timestamp > d.typedData.message.deadline ? "not-deposited" : "pending"
	} catch {
		return "pending"
	}
}
