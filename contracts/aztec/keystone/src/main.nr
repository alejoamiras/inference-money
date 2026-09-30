// KEYSTONE: proves the Noir content-hashes equal the L1 (Solidity) ones for
// fixed vectors. The matching L1 assertions live in contracts/evm
// (test/ContentHash.t.sol) against the SAME constants. Equality across both
// toolchains is the one cross-chain boundary guard the TXE can't provide: if a
// selector or arg order ever drifts, a deposit's L1->L2 message becomes
// unconsumable and funds strand. Run: scripts/run-txe-tests.sh --crate keystone.

use aztec::hash::compute_secret_hash;
use aztec::protocol::address::{AztecAddress, EthAddress};
use aztec::protocol::traits::FromField;
use claim_secret_lib::{derive_claim_secret, DOM_SEP__TOKEN_BRIDGE_PRIVATE_CLAIM_SECRET};
use token_portal_content_hash_lib::{
    get_mint_to_private_content_hash, get_mint_to_public_content_hash, get_withdraw_content_hash,
};

fn main() {}

#[test]
fn mint_to_public_matches_l1() {
    let to = AztecAddress::from_field(0x1234);
    let h = get_mint_to_public_content_hash(to, 1_000_000);
    assert(h == 0x00fb464b41c6a08b28bfe9b8a11c1c4dcd2d4c9c66e703988cb76eb00e140dcc);
}

#[test]
fn mint_to_private_matches_l1() {
    let h = get_mint_to_private_content_hash(1_000_000);
    assert(h == 0x00009b1ee836fa551bb50bb45e2c8e698cc680c6e68e429370625119a2c63954);
}

#[test]
fn withdraw_matches_l1() {
    let recipient = EthAddress::from_field(0xBEEF);
    let caller = EthAddress::zero();
    let h = get_withdraw_content_hash(recipient, 1_000_000, caller);
    assert(h == 0x00ac390e12f1097130e1a7c2e5eea30780cd11d12002b8de22d608cf10a60775);
}

// ─── Recipient-committed private-claim secret derivation ─────────────
// The keystone's second cross-toolchain boundary: derive_claim_secret + compute_secret_hash
// must byte-match the TS mirror (packages/bridge-core/src/claim-secret.test.ts) for the SAME
// (salt, recipient) vectors — a drift strands every private deposit.
// The TS test asserts the identical literals.

// poseidon2_hash_bytes("nulo_dom_sep__token_bridge_private_claim_secret") as u32. Distinct from the
// FPC fuel separator (3952304070) — the cross-protocol-secret-reuse tripwire.
#[test]
fn claim_secret_dom_sep_is_pinned() {
    assert(DOM_SEP__TOKEN_BRIDGE_PRIVATE_CLAIM_SECRET == 3140354885);
    assert(DOM_SEP__TOKEN_BRIDGE_PRIVATE_CLAIM_SECRET != 3952304070);
}

#[test]
fn claim_secret_vectors_match_ts() {
    // (salt, recipient) -> derived secret
    let s0 = derive_claim_secret(0, AztecAddress::from_field(0));
    assert(s0 == 0x1bcb2e97aaeb9788f9b23d331c90b0e138b8fa84890f1fb045c4c260b26e1a4f);
    let s1 = derive_claim_secret(1, AztecAddress::from_field(2));
    assert(s1 == 0x12e754c717173c3dd6f22932580bf8332274034b2c4a6a8ec8d682b482e104a5);
    let s2 = derive_claim_secret(0x1234567890abcdef, AztecAddress::from_field(0xdeadbeef));
    assert(s2 == 0x02c856f2079a8e1cc126d02e81cd409c7ee02e0c4c7cd2dd9450edaa8c681e7d);
}

#[test]
fn claim_secret_hash_vectors_match_ts() {
    // L1 commits to poseidon2_hash_with_separator([derive_claim_secret(salt, recipient)], DOM_SEP__SECRET_HASH).
    let h0 = compute_secret_hash([derive_claim_secret(0, AztecAddress::from_field(0))]);
    assert(h0 == 0x087647b3c1976bde1cf12bfa5213c1d619f4f0b9a0bae6e1000d7030fcb9d5fc);
    let h1 = compute_secret_hash([derive_claim_secret(1, AztecAddress::from_field(2))]);
    assert(h1 == 0x23d9fa16980e66c10886f09780ea412bd1c942a0a6e588d838ea05d7228c6754);
    let h2 =
        compute_secret_hash([derive_claim_secret(0x1234567890abcdef, AztecAddress::from_field(0xdeadbeef))]);
    assert(h2 == 0x2a636f84225eec69e412ed5dffd735f1ac8ff6d28b24dac5d796f0c2a648ac1c);
}

// ─── Fuzz properties (nargo runs parameterized tests with random inputs) ───
// The recipient-commitment property needs derive_claim_secret to be injective ENOUGH that a
// different (salt, recipient) never collides onto the committed secret; these random-input
// assertions pin the two one-bit-flip neighbors across the whole field domain.

#[test]
fn fuzz_derive_changes_with_salt(salt: Field, recipient_field: Field) {
    let r = AztecAddress::from_field(recipient_field);
    assert(
        derive_claim_secret(salt, r) != derive_claim_secret(salt + 1, r),
        "salt neighbor collision in derive_claim_secret",
    );
}

#[test]
fn fuzz_derive_changes_with_recipient(salt: Field, recipient_field: Field) {
    let r0 = AztecAddress::from_field(recipient_field);
    let r1 = AztecAddress::from_field(recipient_field + 1);
    assert(
        derive_claim_secret(salt, r0) != derive_claim_secret(salt, r1),
        "recipient neighbor collision in derive_claim_secret",
    );
}
