// Recipient-committed private-claim secret derivation. The one code object BOTH the
// token_bridge contract (which consumes with it) and the keystone (which pins it against
// the TS mirror in packages/bridge-core/src/claim-secret.ts) depend on — a single source
// so the two toolchains cannot drift a deposit into an unclaimable state.
//
// The property: the L1->L2 private-deposit message commits to
// `compute_secret_hash(derive_claim_secret(salt, recipient))`. Because claim_private
// re-derives the consumption secret from its `recipient` ARGUMENT, a claim naming any
// recipient other than the one bound at deposit time yields a different secret whose hash
// can't match — so a relayer holding (salt, recipient, amount, leaf) can submit the claim
// FOR a user but can never redirect the funds. Binding rests on poseidon2 preimage
// resistance + this being the sole consumption path (enforced in token_bridge + the
// sole-consumer static check).
use aztec::protocol::address::AztecAddress;
use aztec::protocol::hash::poseidon2_hash_with_separator;
use aztec::protocol::traits::ToField;

// poseidon2_hash_bytes("nulo_dom_sep__token_bridge_private_claim_secret") as u32 — pinned
// literal, NOT computed at load (mirrors the FPC constant discipline in private-fuel.ts). The
// TS keystone (claim-secret.test.ts) re-derives it from the string and asserts equality, AND
// asserts it differs from the FPC fuel separator (3952304070) and the protocol secret-hash
// separator — the cross-protocol-reuse tripwire. The `nulo_` prefix is inherited
// from the bridge this was ported from, not Aztec-canonical; changing it re-keys every claim.
pub global DOM_SEP__TOKEN_BRIDGE_PRIVATE_CLAIM_SECRET: u32 = 3140354885;

pub fn derive_claim_secret(claim_salt: Field, recipient: AztecAddress) -> Field {
    poseidon2_hash_with_separator(
        [claim_salt, recipient.to_field()],
        DOM_SEP__TOKEN_BRIDGE_PRIVATE_CLAIM_SECRET,
    )
}
