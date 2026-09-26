import { Fr } from "@aztec/aztec.js/fields"
import { computeL2ToL1MembershipWitness } from "@aztec/stdlib/messaging"
import { BaseError, bytesToHex, ContractFunctionRevertedError, type Hex } from "viem"
import { TOKEN_PORTAL_ABI } from "./abi"
import type { ExitNode, ExitTicket } from "./exit"
import { awaitL1Receipt } from "./l1-receipt"
import type { BridgeManifest } from "./manifest"
import { assertSigningContext } from "./network"
import type { OutboxReader } from "./outbox"
import type { L1Ctx, StageSink } from "./types"

/** The Outbox membership proof `TokenPortal.withdraw` takes. */
export interface OutboxProof {
	epoch: bigint
	numCheckpointsInEpoch: bigint
	leafIndex: bigint
	path: Hex[]
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
	const message = Fr.fromHexString(t.messageHash)
	let lastError: unknown
	for (let attempt = 1; attempt <= MAX_PROOF_REBUILDS; attempt++) {
		try {
			const w = await computeL2ToL1MembershipWitness(node, outbox, message, t.l2TxHash, t.messageIndexInTx)
			if (!w) return "pending"
			return {
				epoch: BigInt(w.epochNumber),
				numCheckpointsInEpoch: BigInt(w.numCheckpointsInEpoch),
				leafIndex: w.leafIndex,
				path: w.siblingPath.toBufferArray().map((b) => bytesToHex(b)),
			}
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

/** Simulates, then sends `TokenPortal.withdraw`; the recipient is fixed by the message, so any account may submit it. */
export async function withdrawOnL1(t: ExitTicket, p: OutboxProof, l1: L1Ctx, m: BridgeManifest): Promise<Hex> {
	await assertSigningContext(l1, null, m, { l1Account: l1.account })
	const call = {
		address: m.l1.portal,
		abi: TOKEN_PORTAL_ABI,
		functionName: "withdraw",
		args: [t.recipient, t.amount, false, p.epoch, p.numCheckpointsInEpoch, p.leafIndex, p.path],
		account: l1.account,
	} as const
	try {
		await l1.publicClient.simulateContract(call)
	} catch (e) {
		const name = revertName(e)
		if (name === "Outbox__AlreadyNullified") throw new AlreadyWithdrawnError({ cause: e })
		if (name && STALE_PROOF_REVERTS.has(name)) throw new StaleProofError({ cause: e })
		throw e
	}
	const hash = await l1.walletClient.writeContract({ ...call, chain: l1.walletClient.chain ?? null })
	await awaitL1Receipt(l1.publicClient, hash)
	return hash
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
