import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract } from "@aztec/aztec.js/contracts"
import { type FeePaymentMethod, SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { Fr } from "@aztec/aztec.js/fields"
import type { Wallet } from "@aztec/aztec.js/wallet"
import { getContractInstanceFromInstantiationParams } from "@aztec/stdlib/contract"
import { sponsoredFpcArtifact, tokenBridgeArtifact } from "./artifacts"
import type { ClaimTicket } from "./deposit"
import type { BridgeManifest } from "./manifest"
import type { StageSink } from "./types"

export type ClaimResult = "claimed" | "already-consumed"

/**
 * Who pays a tx's fee. The wallet's default payer is usually the user's own account, which links it to a private claim
 * or exit; the sponsor does not. Private ops default to the sponsor and public ones to the wallet; an explicit choice
 * wins either way (a fresh account holds no Fee Juice to pay a public claim with).
 */
export type FeeChoice = "sponsored" | "wallet-default"

/** The payment a sponsored choice sends with, or undefined for the wallet's default payer. */
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

// aztec-nr's consume asserts (public, private) and the sequencer's duplicate-nullifier rejection.
const ALREADY_CONSUMED = /already nullified|No non-nullified L1 to L2 message|existing nullifier|duplicate nullifier/i
// The message is not yet in the tree the wallet's PXE anchors to.
const NOT_YET_CLAIMABLE = /Tried to consume nonexistent L1-to-L2 message|No L1 to L2 message found/i
const FEE_PAYER_FAILED = /fee payer|insufficient fee|not enough balance for fee/i

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

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

/**
 * Mints the deposit on L2 from `from` (the recipient or a relayer; a private claim cannot be redirected either way),
 * paid per {@link FeeChoice}.
 */
export async function claim(
	t: ClaimTicket,
	wallet: Wallet,
	m: BridgeManifest,
	opts: { from: AztecAddress; fee?: FeeChoice },
): Promise<ClaimResult> {
	const fee = feeFor(t.draft.intent.kind, m, opts.fee)
	const sponsored = fee !== undefined
	try {
		await claimCall(t, wallet, m).send({ from: opts.from, fee })
		return "claimed"
	} catch (e) {
		if (ALREADY_CONSUMED.test(message(e))) return "already-consumed"
		if (sponsored && FEE_PAYER_FAILED.test(message(e))) {
			throw new SponsorUnavailableError("The fee sponsor could not pay for this claim. It is kept; retry later.", { cause: e })
		}
		throw e
	}
}
