import {
	AlreadyWithdrawnError,
	BridgePausedError,
	ExitRevertedError,
	ExitUnconfirmedError,
	isUserRejection,
	NetworkMismatchError,
	SponsorUnavailableError,
	StaleProofError,
} from "@inference-money/bridge-core"
import { BaseError } from "viem"
import { normalizeError } from "@/wallet/errors"

/** Errors whose own message is already written for the user. */
const OWN_WORDS = [
	BridgePausedError,
	NetworkMismatchError,
	SponsorUnavailableError,
	ExitUnconfirmedError,
	ExitRevertedError,
	AlreadyWithdrawnError,
	StaleProofError,
] as const

/** One sentence a user can act on, for any failure a bridge flow meets. */
export function explain(e: unknown): string {
	if (isUserRejection(e)) return "You declined the request in your wallet."
	if (OWN_WORDS.some((C) => e instanceof C)) return (e as Error).message
	// viem's `details` is raw RPC text; its short message is the readable one.
	if (e instanceof BaseError) return e.shortMessage
	return normalizeError(e).message
}
