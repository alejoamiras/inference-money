// The one derivation token_bridge consumes with and the keystone pins against
// packages/bridge-core/src/claim-secret.ts, so the toolchains cannot drift a deposit into an unclaimable state.
//
// A private deposit's message commits to `compute_secret_hash(derive_claim_secret(salt, recipient))`, and both of its
// consumers re-derive the secret from their `recipient` argument: claim_private, which only the recipient may submit,
// and return_deposit_private, which only pays the depositor back. Whoever holds the claim data can return a deposit
// but never redirect it. Rests on poseidon2 preimage resistance and those two being the only consumers of
// private-deposit messages (scripts/check-sole-consumer.sh).
use aztec::protocol::address::AztecAddress;
use aztec::protocol::hash::poseidon2_hash_with_separator;
use aztec::protocol::traits::ToField;

// poseidon2_hash_bytes("nulo_dom_sep__token_bridge_private_claim_secret") as u32, pinned as a literal; the keystones
// re-derive it and assert it differs from the FPC fuel and protocol secret-hash separators. The inherited `nulo_`
// prefix is not Aztec-canonical, but changing it re-keys every claim.
pub global DOM_SEP__TOKEN_BRIDGE_PRIVATE_CLAIM_SECRET: u32 = 3140354885;

pub fn derive_claim_secret(claim_salt: Field, recipient: AztecAddress) -> Field {
    poseidon2_hash_with_separator(
        [claim_salt, recipient.to_field()],
        DOM_SEP__TOKEN_BRIDGE_PRIVATE_CLAIM_SECRET,
    )
}
