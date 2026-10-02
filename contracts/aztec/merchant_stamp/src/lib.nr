// The merchant token's cross-toolchain constants: the request stamp and the side-hint capsule slot. Mirrored in
// packages/bridge-core/src/stamp.ts and pinned against it by the keystone.
//
// A request (a partial note's commitment `c`) opened for a merchant recipient pushes `stamp(c)`; one a merchant opens
// for a user pushes `pad(c)` instead, so both publish one nullifier and an observer without `c` cannot tell them apart.
// The token pushes both unsiloed and the kernel silos them with its address, so no other contract can forge a stamp.
use aztec::protocol::hash::poseidon2_hash_with_separator;

// poseidon2_hash_bytes("dom_sep__merchant_token_stamp[_pad]") as u32, pinned as literals; the keystone re-derives
// both and asserts they differ from each other, from every protocol and aztec-nr separator, and from the claim secret's.
pub global DOM_SEP__MERCHANT_STAMP: u32 = 1404036670;
pub global DOM_SEP__MERCHANT_STAMP_PAD: u32 = 3491815610;

// poseidon2_hash_bytes("merchant_token_side_hint_capsule_slot"): where a tx's capsule tells the token which side of a
// restricted call to prove. Read at the global (zero) capsule scope, which the PXE allows every tx.
pub global MERCHANT_SIDE_SLOT: Field =
    0x0bfc6bf5b3874bc783b148cc9a19595a0ec8267dbf92d1ecd82ca70f441668ef;

// poseidon2_hash_bytes("merchant_token_request_opened"): heads the offchain effect `[REQUEST_OPENED_EFFECT, c]` that
// tells the opener's client which commitment it opened. A sent tx returns no private return values, and `c` embeds
// randomness drawn while proving, so a simulation's return value is a different commitment.
pub global REQUEST_OPENED_EFFECT: Field =
    0x2c0264a3f3d089a68139762c50b6f5f68e6cc5d8662de00195b492d228a73f73;

pub fn stamp(commitment: Field) -> Field {
    poseidon2_hash_with_separator([commitment], DOM_SEP__MERCHANT_STAMP)
}

pub fn pad(commitment: Field) -> Field {
    poseidon2_hash_with_separator([commitment], DOM_SEP__MERCHANT_STAMP_PAD)
}
