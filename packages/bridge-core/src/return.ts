import { AztecAddress, EthAddress } from "@aztec-labs/aztec.js/addresses"
import { Contract, NO_WAIT } from "@aztec-labs/aztec.js/contracts"
import { Fr } from "@aztec-labs/aztec.js/fields"
import type { TxHash } from "@aztec-labs/aztec.js/tx"
import type { Wallet } from "@aztec-labs/aztec.js/wallet"
import type { Address } from "viem"
import { tokenBridgeArtifact } from "./artifacts"
import {
	type ClaimableNode,
	type ClaimWait,
	type FeeChoice,
	feeFor,
	sponsorFailure,
	type WaitClaimableOptions,
	waitConsumable,
} from "./claim"
import type { ClaimTicket } from "./deposit"
import { type ExitNode, type ExitTicket, locateWithdrawal } from "./exit"
import type { BridgeManifest } from "./manifest"
import type { StageSink } from "./types"

/**
 * The return was sent but its withdrawal could not be located yet. Returning again would fail on the consumed message:
 * resume with `exitTicketFromTx` from these fields.
 */
export class ReturnUnconfirmedError extends Error {
	constructor(
		readonly l2TxHash: TxHash,
		readonly depositor: Address,
		readonly amount: bigint,
		options?: ErrorOptions,
	) {
		super(
			`Return ${l2TxHash} was sent, but its withdrawal could not be located yet. Do not return it again; resume it from this hash.`,
			options,
		)
		this.name = "ReturnUnconfirmedError"
	}
}

/** The return reverted with the rest of its app logic: the deposit is unconsumed, so it can still be claimed or returned. */
export class ReturnRevertedError extends Error {
	constructor(readonly l2TxHash: TxHash) {
		super(`The return ${l2TxHash} was rejected on Aztec, so the deposit is untouched. If the bridge is paused, wait for it to resume.`)
		this.name = "ReturnRevertedError"
	}
}

function returnCall(t: ClaimTicket, wallet: Wallet, m: BridgeManifest) {
	const bridge = Contract.at(AztecAddress.fromStringUnsafe(m.l2.bridge.address), tokenBridgeArtifact, wallet)
	const { amount, recipient, kind } = t.draft.intent
	const ret = kind === "private" ? bridge.methods.return_deposit_private! : bridge.methods.return_deposit_public!
	return ret(recipient, amount, t.draft.secretOrSalt, new Fr(t.leafIndex), EthAddress.fromString(t.depositor))
}

/** {@link waitConsumable} for the return of `t` from `from`'s wallet; call it before {@link returnDeposit}. */
export function waitReturnable(
	t: ClaimTicket,
	node: ClaimableNode,
	wallet: Wallet,
	m: BridgeManifest,
	from: AztecAddress,
	on?: StageSink<ClaimWait>,
	opts: WaitClaimableOptions = {},
): Promise<void> {
	return waitConsumable(t, node, () => returnCall(t, wallet, m).simulate({ from }), on, opts)
}

/**
 * Sends an unclaimed deposit back to the Ethereum address it came from: consumes its message on L2, mints nothing, and
 * emits the withdraw an exit to `t.depositor` would, which anyone may finish on L1 (`finishWithdrawal`) once its epoch
 * is proven. Whoever holds the claim data may send it, paid per {@link FeeChoice}. A merchant's public deposit is
 * claimed, never returned. Failures after the send mirror `exitToL1`'s: {@link ReturnUnconfirmedError} carries the
 * hash, and only a checkpointed revert with no withdraw message is a {@link ReturnRevertedError}.
 */
export async function returnDeposit(
	t: ClaimTicket,
	wallet: Wallet,
	node: ExitNode,
	m: BridgeManifest,
	opts: { from: AztecAddress; fee?: FeeChoice },
): Promise<ExitTicket> {
	const { amount, kind } = t.draft.intent
	const fee = feeFor(kind, m, opts.fee)
	let txHash: TxHash
	try {
		txHash = (await returnCall(t, wallet, m).send({ from: opts.from, fee, wait: NO_WAIT })).txHash
	} catch (e) {
		throw (fee && sponsorFailure(e, "return")) || e
	}
	const located = await locateWithdrawal(t.depositor, amount, txHash, node, m).catch((cause: unknown) => {
		throw new ReturnUnconfirmedError(txHash, t.depositor, amount, { cause })
	})
	if (located === "reverted") throw new ReturnRevertedError(txHash)
	return located
}
