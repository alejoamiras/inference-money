import { AztecAddress, EthAddress } from "@aztec-labs/aztec.js/addresses"
import { SetPublicAuthwitContractInteraction } from "@aztec-labs/aztec.js/authorization"
import { BatchCall, Contract, NO_WAIT } from "@aztec-labs/aztec.js/contracts"
import { Fr } from "@aztec-labs/aztec.js/fields"
import { waitForTx } from "@aztec-labs/aztec.js/node"
import type { TxHash } from "@aztec-labs/aztec.js/tx"
import type { Wallet } from "@aztec-labs/aztec.js/wallet"
import { computeL2ToL1MessageHash } from "@aztec-labs/stdlib/hash"
import type { AztecNode } from "@aztec-labs/stdlib/interfaces/client"
import { computeL2ToL1MembershipWitness, getL2ToL1MessageLeafId } from "@aztec-labs/stdlib/messaging"
import { type Address, type Hex, isAddressEqual, zeroAddress } from "viem"
import { tokenArtifact, tokenBridgeArtifact } from "./artifacts"
import { type FeeChoice, feeFor, L2_DONE, type SponsorUnavailableError, sponsorFailure } from "./claim"
import { withdrawContentHash } from "./content-hash"
import type { BridgeManifest } from "./manifest"
import type { OutboxReader } from "./outbox"
import { MAX_L2_AMOUNT } from "./types"

export interface ExitIntent {
	kind: "public" | "private"
	/** The Aztec account whose tokens burn. */
	from: AztecAddress
	recipientL1: Address
	amount: bigint
	/** A merchant's private exit, which may go anywhere; a user's goes only to its funding address. Default false. */
	asMerchant?: boolean
}

/** Everything a withdrawal needs, recoverable from the L2 tx hash plus recipient and amount (`exitTicketFromTx`). */
export interface ExitTicket {
	l2TxHash: TxHash
	recipient: Address
	amount: bigint
	messageHash: Hex
	/** Which of the tx's L2->L1 messages: identical exits in one tx are distinct, separately consumable messages. */
	messageIndexInTx: number
}

export type ExitNode = Pick<AztecNode, "getTxEffect" | "getL2ToL1Messages" | "getTxReceipt" | "getBlock" | "getCheckpointsData">

/**
 * Refused before any burn. The portal's payout check measures its own balance drop and a self-transfer drops nothing,
 * so an exit to the portal is unwithdrawable; the router has no way to release tokens sent to it.
 */
export function assertExitIntent(e: ExitIntent, m: BridgeManifest): void {
	if (e.amount <= 0n) throw new Error("The amount must be positive.")
	if (e.amount > MAX_L2_AMOUNT) throw new Error("The amount exceeds what the L2 token can hold.")
	for (const [label, blocked] of [
		["the zero address", zeroAddress],
		["the bridge portal", m.l1.portal],
		["the deposit router", m.l1.router],
	] as const) {
		if (isAddressEqual(e.recipientL1, blocked)) throw new Error(`An Ethereum recipient of ${label} could never be paid out.`)
	}
}

/** The L2->L1 message a bridge exit of `amount` to `recipient` emits: anyone may submit its withdrawal on L1. */
export async function expectedExitMessage(recipient: Address, amount: bigint, m: BridgeManifest): Promise<Fr> {
	return computeL2ToL1MessageHash({
		l2Sender: AztecAddress.fromStringUnsafe(m.l2.bridge.address),
		l1Recipient: EthAddress.fromString(m.l1.portal),
		content: Fr.fromHexString(await withdrawContentHash(recipient, amount, zeroAddress)),
		rollupVersion: new Fr(m.l2.rollupVersion),
		chainId: new Fr(m.l1.chainId),
	})
}

async function occurrencesInTx(node: Pick<AztecNode, "getTxEffect">, txHash: TxHash, expected: Fr): Promise<number[] | undefined> {
	const effect = await node.getTxEffect(txHash)
	if (!effect) return undefined
	return effect.data.l2ToL1Msgs.flatMap((msg, i) => (msg.equals(expected) ? [i] : []))
}

function exitCall(e: ExitIntent, wallet: Wallet, m: BridgeManifest, nonce: Fr) {
	const bridge = Contract.at(AztecAddress.fromStringUnsafe(m.l2.bridge.address), tokenBridgeArtifact, wallet)
	const token = Contract.at(AztecAddress.fromStringUnsafe(m.l2.token.address), tokenArtifact, wallet)
	const recipient = EthAddress.fromString(e.recipientL1)
	const exit =
		e.kind === "private"
			? bridge.methods.exit_to_l1_private!(recipient, e.amount, EthAddress.ZERO, nonce, e.asMerchant ?? false)
			: bridge.methods.exit_to_l1_public!(recipient, e.amount, EthAddress.ZERO, nonce)
	const burn = e.kind === "private" ? token.methods.burn_private! : token.methods.burn_public!
	return { exit, burn: burn(e.from, e.amount, nonce) }
}

/**
 * The burn mined but its ticket could not be built. Exiting again would burn again: recover with
 * {@link exitTicketFromTx} from these fields.
 */
export class ExitUnconfirmedError extends Error {
	constructor(
		readonly l2TxHash: TxHash,
		readonly recipient: Address,
		readonly amount: bigint,
		options?: ErrorOptions,
	) {
		super(
			`Exit ${l2TxHash} was sent, but its withdrawal could not be located yet. Do not exit again; resume it from this hash.`,
			options,
		)
		this.name = "ExitUnconfirmedError"
	}
}

/**
 * The exit tx reverted, so its burn and withdraw message were discarded with the rest of its app logic: there is
 * nothing to finish, and exiting again is safe.
 */
export class ExitRevertedError extends Error {
	constructor(readonly l2TxHash: TxHash) {
		super(
			`The withdrawal ${l2TxHash} was rejected on Aztec, so nothing was burned. If the bridge is paused, wait for it to resume; otherwise try again.`,
		)
		this.name = "ExitRevertedError"
	}
}

async function sendExit(e: ExitIntent, wallet: Wallet, m: BridgeManifest, fee: ReturnType<typeof feeFor>): Promise<TxHash> {
	const proxy = AztecAddress.fromStringUnsafe(m.l2.proxy.address)
	const { exit, burn } = exitCall(e, wallet, m, Fr.random())
	if (e.kind === "private") {
		const witness = await wallet.createAuthWit(e.from, { caller: proxy, call: await burn.getFunctionCall() })
		return (await exit.send({ from: e.from, authWitnesses: [witness], fee, wait: NO_WAIT })).txHash
	}
	const allow = await SetPublicAuthwitContractInteraction.create(wallet, e.from, { caller: proxy, action: burn }, true)
	return (await new BatchCall(wallet, [allow, exit]).send({ from: e.from, fee, wait: NO_WAIT })).txHash
}

/**
 * Burns on L2 and emits the withdraw message, paid per {@link FeeChoice}. The burn is authorized for the proxy (the
 * bridge's only path to the token) with a fresh nonce: an off-chain witness for a private exit, and an auth-registry
 * entry batched into the same tx for a public one. A sponsor that cannot pay is a {@link SponsorUnavailableError} with
 * nothing burned. The send returns its hash before any wait, so every failure after it, the wait for the checkpoint
 * included, is an {@link ExitUnconfirmedError} carrying that hash; only a checkpointed revert with no withdraw message
 * in its effect, which burned nothing, is an {@link ExitRevertedError}.
 */
export async function exitToL1(
	e: ExitIntent,
	wallet: Wallet,
	node: ExitNode,
	m: BridgeManifest,
	opts: { fee?: FeeChoice } = {},
): Promise<ExitTicket> {
	assertExitIntent(e, m)
	const fee = feeFor(e.kind, m, opts.fee)
	let txHash: TxHash
	try {
		txHash = await sendExit(e, wallet, m, fee)
	} catch (err) {
		throw (fee && sponsorFailure(err, "withdrawal")) || err
	}
	const located = await locateExit(e, txHash, node, m).catch((cause: unknown) => {
		throw new ExitUnconfirmedError(txHash, e.recipientL1, e.amount, { cause })
	})
	if (located === "reverted") throw new ExitRevertedError(txHash)
	return located
}

async function locateExit(e: ExitIntent, txHash: TxHash, node: ExitNode, m: BridgeManifest): Promise<ExitTicket | "reverted"> {
	// Only `getTxReceipt` is read.
	const receipt = await waitForTx(node as AztecNode, txHash, { ...L2_DONE, dontThrowOnRevert: true })
	const expected = await expectedExitMessage(e.recipientL1, e.amount, m)
	const found = await occurrencesInTx(node, txHash, expected)
	// A revert proves nothing burned only alongside an effect that lacks the message: setup effects survive a revert.
	if (!found) throw new Error(`Exit ${txHash} is checkpointed, but the node returned no effect for it.`)
	const [index, ...rest] = found
	if (index === undefined && receipt.hasExecutionReverted()) return "reverted"
	if (index === undefined || rest.length > 0) throw new Error(`Exit ${txHash} mined without exactly one matching withdraw message.`)
	return {
		l2TxHash: txHash,
		recipient: e.recipientL1,
		amount: e.amount,
		messageHash: expected.toString() as Hex,
		messageIndexInTx: index,
	}
}

/** Consumed on the L1 Outbox; a message whose epoch is not proven yet cannot have been. */
async function isConsumed(node: ExitNode, outbox: OutboxReader, txHash: TxHash, message: Fr, index: number): Promise<boolean> {
	const witness = await computeL2ToL1MembershipWitness(node, outbox, message, txHash, index)
	if (!witness) return false
	return outbox.isConsumed(BigInt(witness.epochNumber), getL2ToL1MessageLeafId(witness))
}

/** Whether this occurrence of the exit is already withdrawn on L1; false while its epoch is unproven. */
export function isExitWithdrawn(t: ExitTicket, node: ExitNode, outbox: OutboxReader): Promise<boolean> {
	return isConsumed(node, outbox, t.l2TxHash, Fr.fromHexString(t.messageHash), t.messageIndexInTx)
}

/**
 * Resumes a withdrawal from what the user can still name: the L2 tx hash, the L1 recipient and the amount. The expected
 * message is recomputed and must be in that tx ("not-found" otherwise, never "withdrawn"). Among identical occurrences
 * it takes `occurrence` if given, else the first not yet consumed; "all-consumed" only when every one is.
 */
export async function exitTicketFromTx(
	l2TxHash: TxHash,
	recipient: Address,
	amount: bigint,
	node: ExitNode,
	outbox: OutboxReader,
	m: BridgeManifest,
	occurrence?: number,
): Promise<ExitTicket | "all-consumed" | "not-found"> {
	const expected = await expectedExitMessage(recipient, amount, m)
	const indices = (await occurrencesInTx(node, l2TxHash, expected)) ?? []
	const ticket = (i: number): ExitTicket => ({
		l2TxHash,
		recipient,
		amount,
		messageHash: expected.toString() as Hex,
		messageIndexInTx: i,
	})
	if (occurrence !== undefined) return indices.includes(occurrence) ? ticket(occurrence) : "not-found"
	if (indices.length === 0) return "not-found"
	for (const i of indices) {
		if (!(await isConsumed(node, outbox, l2TxHash, expected, i))) return ticket(i)
	}
	return "all-consumed"
}
