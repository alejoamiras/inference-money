// The one derivation token_bridge consumes with and the keystone pins against
// packages/bridge-core/src/claim-secret.ts, so the toolchains cannot drift a deposit into an unclaimable state.
//
// A private deposit's message commits to `compute_secret_hash(derive_claim_secret(salt, recipient))` and
// claim_private re-derives the secret from its `recipient` argument: a relayer holding the claim data can claim FOR
// the recipient but never redirect. Rests on poseidon2 preimage resistance and claim_private being the sole consumer
// of private-deposit messages (scripts/check-sole-consumer.sh).
use aztec::protocol::address::AztecAddress;
use aztec::protocol::hash::poseidon2_hash_with_separator;
use aztec::protocol::traits::ToField;

// poseidon2_hash_bytes("nulo_dom_sep__token_bridge_private_claim_secret") as u32, pinned as a literal; the TS
// keystone re-derives it and asserts it differs from the protocol secret-hash separator. The inherited `nulo_` prefix
// is not Aztec-canonical, but changing it re-keys every claim.
pub global DOM_SEP__TOKEN_BRIDGE_PRIVATE_CLAIM_SECRET: u32 = 3140354885;

pub fn derive_claim_secret(claim_salt: Field, recipient: AztecAddress) -> Field {
    poseidon2_hash_with_separator(
        [claim_salt, recipient.to_field()],
        DOM_SEP__TOKEN_BRIDGE_PRIVATE_CLAIM_SECRET,
    )
}
