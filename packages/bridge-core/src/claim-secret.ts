/**
 * Recipient-committed private claims: the TS mirror of the Noir `claim_secret::derive_claim_secret`.
 *
 * A private deposit commits `secretHash = computeSecretHash(deriveClaimSecret(salt, recipient))` on L1, and both of
 * its L2 consumers re-derive the secret from their `recipient` argument: `claim_private`, which only the recipient may
 * submit, and `return_deposit_private`, which pays the depositor back. Naming any other recipient derives a different
 * secret that cannot consume the message, so whoever holds the salt can return the deposit but never redirect it. That
 * holds only while no raw-secret consumption path exists on L2 (check-sole-consumer.sh), not because the salt stays
 * private.
 */
import type { AztecAddress } from "@aztec-labs/aztec.js/addresses"
import type { Fr } from "@aztec-labs/aztec.js/fields"
import { poseidon2HashWithSeparator } from "@aztec-labs/foundation/crypto/sync"
import { computeSecretHash } from "@aztec-labs/stdlib/hash"

/**
 * `poseidon2_hash_bytes("nulo_dom_sep__token_bridge_private_claim_secret") as u32`, equal to the Noir constant; the
 * string predates this repo and is load-bearing. A literal, not computed at import: poseidon at module load crashes
 * browser test environments before Barretenberg initializes. The test re-derives it.
 */
export const DOM_SEP__TOKEN_BRIDGE_PRIVATE_CLAIM_SECRET = 3140354885

/**
 * `salt` MUST be a fresh `Fr.random()`. The secret hash and the amount are public on L1, so a guessable salt lets an
 * observer brute-force `(salt, recipient)` and learn the recipient before the claim.
 */
export const deriveClaimSecret = (salt: Fr, recipient: AztecAddress): Fr =>
	poseidon2HashWithSeparator([salt, recipient], DOM_SEP__TOKEN_BRIDGE_PRIVATE_CLAIM_SECRET)

export const claimSecretHash = (salt: Fr, recipient: AztecAddress): Promise<Fr> => computeSecretHash(deriveClaimSecret(salt, recipient))
