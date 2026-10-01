/**
 * The merchant token's request stamps, side-hint capsule slot and request effect: the TS mirror of
 * `contracts/aztec/merchant_stamp`.
 *
 * Opening a request (a partial note's commitment `c`) pushes `stamp(c)` when the recipient is proven a merchant and
 * `pad(c)` otherwise, and a user may pay only into a stamped request. The token pushes both unsiloed, so on chain each
 * appears siloed with the token's address.
 */
import type { AztecAddress } from "@aztec-labs/aztec.js/addresses"
import { Fr } from "@aztec-labs/aztec.js/fields"
import { poseidon2HashWithSeparator } from "@aztec-labs/foundation/crypto/sync"
import { siloNullifier } from "@aztec-labs/stdlib/hash"

/**
 * `poseidon2_hash_bytes("dom_sep__merchant_token_stamp[_pad]") as u32`, equal to the Noir constants. Literals, not
 * computed at import: poseidon at module load crashes browser test environments before Barretenberg initializes.
 */
export const DOM_SEP__MERCHANT_STAMP = 1404036670
export const DOM_SEP__MERCHANT_STAMP_PAD = 3491815610

/** `poseidon2_hash_bytes("merchant_token_side_hint_capsule_slot")`: where a tx tells the token which side to prove. */
export const MERCHANT_SIDE_SLOT = new Fr(0x0bfc6bf5b3874bc783b148cc9a19595a0ec8267dbf92d1ecd82ca70f441668efn)

/** `poseidon2_hash_bytes("merchant_token_request_opened")`: heads the offchain effect `[tag, c]` an opening emits. */
export const REQUEST_OPENED_EFFECT = new Fr(0x2c0264a3f3d089a68139762c50b6f5f68e6cc5d8662de00195b492d228a73f73n)

export const stamp = (commitment: Fr): Fr => poseidon2HashWithSeparator([commitment], DOM_SEP__MERCHANT_STAMP)
export const pad = (commitment: Fr): Fr => poseidon2HashWithSeparator([commitment], DOM_SEP__MERCHANT_STAMP_PAD)

/** The nullifiers a request `commitment` leaves on chain, as the node indexes them. */
export async function siloedRequestMarks(token: AztecAddress, commitment: Fr): Promise<{ stamp: Fr; pad: Fr }> {
	const [s, p] = await Promise.all([siloNullifier(token, stamp(commitment)), siloNullifier(token, pad(commitment))])
	return { stamp: s, pad: p }
}
