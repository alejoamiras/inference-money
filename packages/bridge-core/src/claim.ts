import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract } from "@aztec/aztec.js/contracts"
import { type FeePaymentMethod, SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { Fr } from "@aztec/aztec.js/fields"
import { TxStatus } from "@aztec/aztec.js/tx"
import type { Wallet } from "@aztec/aztec.js/wallet"
import { getContractInstanceFromInstantiationParams } from "@aztec/stdlib/contract"
import { siloNullifier } from "@aztec/stdlib/hash"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import { computeFeeJuiceMessageNullifier } from "@aztec/stdlib/messaging"
import { MerkleTreeId } from "@aztec/stdlib/trees"
import { sponsoredFpcArtifact, tokenBridgeArtifact } from "./artifacts"
import { deriveClaimSecret } from "./claim-secret"
import type { ClaimTicket } from "./deposit"
import type { BridgeManifest } from "./manifest"
import type { StageSink } from "./types"

export type ClaimResult = "claimed" | "already-consumed"

/**
 * Who pays a tx's fee. The wallet's default payer usually links the user's account to a private claim or exit; the
 * sponsor does not. Default: sponsored for private ops, the wallet for public ones; an explicit choice overrides.
 */
export type FeeChoice = "sponsored" | "wallet-default"

export function feeFor(kind: "public" | "private", m: BridgeManifest, choice?: FeeChoice): { paymentMethod: FeePaymentMethod } | undefined {
	return (choice ?? (kind === "private" ? "sponsored" : "wallet-default")) === "sponsored"
		? { paymentMethod: sponsoredPayment(m) }
		: undefined
}

/** The network's sponsor could not pay (exhausted, missing or refused); the ticket is untouched and can be retried. */
export class SponsorUnavailableError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options)
		this.name = "SponsorUnavailableError"
	}
}

/**
 * How far an L2 tx must get before the bridge reads its outcome: published to L1 in a checkpoint. Wallets may return
 * at a proposed block, which is dropped if its proposer never publishes it. A checkpoint is still not permanent (an
 * unproven epoch can be pruned), so a claim's secret is kept until {@link waitClaimFinalized}.
 */
export const L2_DONE = { waitForStatus: TxStatus.CHECKPOINTED, timeout: 600 } as const

// aztec-nr's consume asserts (public, private) and the sequencer's duplicate-nullifier rejection.
const ALREADY_CONSUMED = /already nullified|No non-nullified L1 to L2 message|existing nullifier|duplicate nullifier/i
// The message is not yet in the tree the wallet's PXE anchors to.
const NOT_YET_CLAIMABLE = /Tried to consume nonexistent L1-to-L2 message|No L1 to L2 message found/i
const FEE_PAYER_FAILED = /fee payer|insufficient fee|not enough balance for fee/i

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** A sponsored send that failed because the sponsor could not pay, as {@link SponsorUnavailableError}; else undefined. */
export function sponsorFailure(e: unknown, what: string): SponsorUnavailableError | undefined {
	if (!FEE_PAYER_FAILED.test(message(e))) return undefined
	return new SponsorUnavailableError(`The fee sponsor could not pay for this ${what}. It is kept; retry later.`, { cause: e })
}

export function sponsoredPayment(m: BridgeManifest): FeePaymentMethod {
	if (!m.l2.sponsoredFpc) throw new SponsorUnavailableError("This network has no fee sponsor for private transactions.")
	return new SponsoredFeePaymentMethod(AztecAddress.fromStringUnsafe(m.l2.sponsoredFpc))
}

/** The one sponsor this code can vouch for: the pinned SponsoredFPC class at salt 0. */
export const sponsorInstance = () => getContractInstanceFromInstantiationParams(sponsoredFpcArtifact, { salt: Fr.ZERO })

/**
 * Registers the network's sponsor in `wallet`, which must know its class to pay through it. Refuses a manifest whose
 * sponsor is not {@link sponsorInstance}.
 */
export async function registerSponsor(wallet: Pick<Wallet, "registerContract">, m: BridgeManifest): Promise<AztecAddress> {
	if (!m.l2.sponsoredFpc) throw new SponsorUnavailableError("This network has no fee sponsor for private transactions.")
	const instance = await sponsorInstance()
	if (!instance.address.equals(AztecAddress.fromStringUnsafe(m.l2.sponsoredFpc))) {
		throw new SponsorUnavailableError(
			`The manifest's fee sponsor ${m.l2.sponsoredFpc} is not the known SponsoredFPC ${instance.address}.`,
		)
	}
	await wallet.registerContract(instance, sponsoredFpcArtifact)
	return instance.address
}

function claimCall(t: ClaimTicket, wallet: Wallet, m: BridgeManifest) {
	const bridge = Contract.at(AztecAddress.fromStringUnsafe(m.l2.bridge.address), tokenBridgeArtifact, wallet)
	const { amount, recipient, kind } = t.draft.intent
	const leaf = new Fr(t.leafIndex)
	return kind === "private"
		? bridge.methods.claim_private!(recipient, amount, t.draft.secretOrSalt, leaf)
		: bridge.methods.claim_public!(recipient, amount, t.draft.secretOrSalt, leaf)
}

export interface WaitClaimableOptions {
	/** Default 120 polls, 5 s apart (~10 min). */
	attempts?: number
	pollMs?: number
	sleep?: (ms: number) => Promise<void>
}

type ClaimableNode = { getL1ToL2MessageCheckpoint(message: Fr): Promise<unknown> }
type ClaimWait = "waiting-for-inclusion" | "waiting-for-wallet-sync"

async function probeClaimable(
	t: ClaimTicket,
	node: ClaimableNode,
	wallet: Wallet,
	m: BridgeManifest,
	from: AztecAddress,
): Promise<"ready" | ClaimWait> {
	if ((await node.getL1ToL2MessageCheckpoint(Fr.fromHexString(t.messageHash))) === undefined) return "waiting-for-inclusion"
	try {
		await claimCall(t, wallet, m).simulate({ from })
		return "ready"
	} catch (e) {
		if (ALREADY_CONSUMED.test(message(e))) return "ready"
		if (NOT_YET_CLAIMABLE.test(message(e))) return "waiting-for-wallet-sync"
		throw e
	}
}

/**
 * Resolves once the claim would succeed from `from`'s wallet: the message must be in a checkpoint and inside the tree
 * the wallet's PXE anchors to, which only a successful simulation proves. An already-consumed message resolves too, so
 * `claim` reports it.
 */
export async function waitClaimable(
	t: ClaimTicket,
	node: ClaimableNode,
	wallet: Wallet,
	m: BridgeManifest,
	from: AztecAddress,
	on?: StageSink<ClaimWait>,
	opts: WaitClaimableOptions = {},
): Promise<void> {
	const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
	for (let attempt = 0; attempt < (opts.attempts ?? 120); attempt++) {
		const state = await probeClaimable(t, node, wallet, m, from)
		if (state === "ready") return
		on?.(state)
		await sleep(opts.pollMs ?? 5_000)
	}
	throw new Error("The deposit is not claimable yet. It is kept; try again in a few minutes.")
}

export type NullifierNode = Pick<AztecNode, "findLeavesIndexes">

/**
 * Whether the bridge has nullified this ticket's message on L2. The nullifier is aztec-nr's
 * `compute_l1_to_l2_message_nullifier`, which stdlib names after the fee-juice contract; the bridge siloes it.
 */
export async function isClaimConsumed(
	t: ClaimTicket,
	node: NullifierNode,
	m: BridgeManifest,
	at: "checkpointed" | "finalized" = "checkpointed",
): Promise<boolean> {
	const { kind, recipient } = t.draft.intent
	const secret = kind === "private" ? deriveClaimSecret(t.draft.secretOrSalt, recipient) : t.draft.secretOrSalt
	const inner = await computeFeeJuiceMessageNullifier(Fr.fromHexString(t.messageHash), secret)
	const siloed = await siloNullifier(AztecAddress.fromStringUnsafe(m.l2.bridge.address), inner)
	const [hit] = await node.findLeavesIndexes(at, MerkleTreeId.NULLIFIER_TREE, [siloed])
	return hit !== undefined
}

export interface WaitClaimFinalizedOptions {
	/** Default 15 s. There is no attempt cap: until the claim is final, forgetting the secret can lose the deposit. */
	pollMs?: number
	sleep?: (ms: number) => Promise<void>
}

/**
 * Waits until this ticket's claim is in a finalized block, the first point at which its secret may be forgotten: an
 * epoch that misses its proof window is pruned, and an L1 reorg can remove a proof that landed near its deadline.
 * "dropped" once the nullifier is not even checkpointed any more, so the caller claims again; a failed read counts as
 * not final yet.
 */
export async function waitClaimFinalized(
	t: ClaimTicket,
	node: NullifierNode,
	m: BridgeManifest,
	opts: WaitClaimFinalizedOptions = {},
): Promise<"finalized" | "dropped"> {
	const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
	for (;;) {
		const state = await claimFinality(t, node, m).catch(() => "checkpointed" as const)
		if (state !== "checkpointed") return state
		await sleep(opts.pollMs ?? 15_000)
	}
}

async function claimFinality(t: ClaimTicket, node: NullifierNode, m: BridgeManifest): Promise<"finalized" | "checkpointed" | "dropped"> {
	if (await isClaimConsumed(t, node, m, "finalized")) return "finalized"
	return (await isClaimConsumed(t, node, m)) ? "checkpointed" : "dropped"
}

/**
 * Mints the deposit on L2 from `from` (the recipient or a relayer; a private claim cannot be redirected either way),
 * paid per {@link FeeChoice}. "already-consumed" needs this ticket's nullifier on L2: a nullifier error can come from
 * any part of the tx, and a caller may discard the secret on that verdict.
 */
export async function claim(
	t: ClaimTicket,
	node: NullifierNode,
	wallet: Wallet,
	m: BridgeManifest,
	opts: { from: AztecAddress; fee?: FeeChoice },
): Promise<ClaimResult> {
	const fee = feeFor(t.draft.intent.kind, m, opts.fee)
	const sponsored = fee !== undefined
	try {
		await claimCall(t, wallet, m).send({ from: opts.from, fee, wait: L2_DONE })
		return "claimed"
	} catch (e) {
		if (ALREADY_CONSUMED.test(message(e)) && (await isClaimConsumed(t, node, m).catch(() => false))) return "already-consumed"
		throw (sponsored && sponsorFailure(e, "claim")) || e
	}
}
