// The side hint behind every merchant rule check: which side of a restricted call the token proves.
//
// Advice only: the token proves whichever side the hint names, so a wrong hint yields an unprovable tx, never a false
// pass. A tx's capsule decides when present (bridge-core and the showcase attach one, computed from the list's events).
// Without one the hint probes the anchor block, counterparty first, so a merchant counterparty spares the sender's own
// address a query to the node. Both follow the same three rules:
//   1. a merchant side is always kept, and the answer is NEITHER only when no side is a merchant;
//   2. opening a request, a merchant recipient is always proven, so a merchant's request is stamped, never padded;
//   3. otherwise, of two merchants, prove the one with no change scheduled ahead: its read keeps the tx's expiry longest.
// A payment into a request has its own order, by what each proof costs the tx's expiry: a stamp still unmarked (it
// caps nothing a tx would not have anyway), else a merchant payer, else a live stamp (it shortens the expiry), else
// NEITHER.
use aztec::{
    oracle::{capsules, nullifiers::check_nullifier_exists, storage::raw_storage_read},
    protocol::{
        abis::block_header::BlockHeader, address::AztecAddress,
        delayed_public_mutable::delayed_public_mutable_values::unpack_value_change,
        storage::map::derive_storage_slot_in_map, traits::Hash,
    },
    state_vars::{Map, PublicImmutable, StateVariable},
};
use merchant_stamp::{
    MERCHANT_SIDE_SLOT, stamp, stamp_bucket, STAMP_BUCKET_SLOT, STAMP_LIVE_BUCKETS, stamp_unmarked_until,
};

pub global FIRST: u8 = 0;
pub global SECOND: u8 = 1;
pub global NEITHER: u8 = 2;

/// Where the token keeps its merchant list, and the block a private proof reads it at.
pub struct MerchantList {
    pub this: AztecAddress,
    pub anchor: BlockHeader,
    pub merchants_slot: Field,
    pub merchant_off_slot: Field,
}

/// Which of two accounts a transfer or request proves a merchant: FIRST, SECOND or NEITHER. `first` is the recipient
/// (the counterparty, probed first) and `second` the sender or creator; `opening` applies rule 2.
pub unconstrained fn merchant_side_hint(
    list: MerchantList,
    first: AztecAddress,
    second: AztecAddress,
    opening: bool,
) -> u8 {
    capsule_side(list.this).unwrap_or_else(|| {
        let a = probe(list, first);
        if a.merchant & (opening | !a.pending) {
            FIRST
        } else {
            let b = probe(list, second);
            if b.merchant & (!a.merchant | !b.pending) {
                SECOND
            } else if a.merchant {
                FIRST
            } else {
                NEITHER
            }
        }
    })
}

/// Which proof a payment into a request makes, and of which stamp: FIRST (the stamp in the returned bucket), SECOND
/// (`from` is a merchant) or NEITHER. A capsule naming the payer needs no stamp, so none is looked for.
pub unconstrained fn payment_side_hint(
    list: MerchantList,
    commitment: Field,
    from: AztecAddress,
) -> (u8, u64) {
    let named = capsule_side(list.this);
    let bucket = if named.is_some() & (named.unwrap_unchecked() != FIRST) {
        Option::none()
    } else {
        live_stamp(list, commitment)
    };
    let side = named.unwrap_or_else(|| {
        let unmarked = bucket.is_some()
            & (list.anchor.timestamp() < stamp_unmarked_until(bucket.unwrap_unchecked()));
        if unmarked {
            FIRST
        } else if probe(list, from).merchant {
            SECOND
        } else if bucket.is_some() {
            FIRST
        } else {
            NEITHER
        }
    });
    (side, bucket.unwrap_or(0))
}

// The bucket of the request's stamp: the tx's capsule when it carries one (passed through unchecked, like the side),
// else the newest bucket still live at the anchor whose stamp exists there.
unconstrained fn live_stamp(list: MerchantList, commitment: Field) -> Option<u64> {
    capsules::load(list.this, STAMP_BUCKET_SLOT, AztecAddress::zero())
        .map(|bucket: Field| bucket as u64)
        .or_else(|| {
            let newest = stamp_bucket(list.anchor.timestamp());
            let mut found = Option::none();
            for i in 0..STAMP_LIVE_BUCKETS {
                if found.is_none() & (i <= newest) {
                    if check_nullifier_exists(stamp(commitment, newest - i)) {
                        found = Option::some(newest - i);
                    }
                }
            }
            found
        })
}

/// Whether `account` is a listed merchant, switched on, at the anchor block, per the node.
pub unconstrained fn is_merchant_at_anchor(list: MerchantList, account: AztecAddress) -> bool {
    probe(list, account).merchant
}

// Passed through unchecked: the token proves or refuses for any value (anything but FIRST or NEITHER proves the
// second side), and the tests rely on out-of-range capsules reaching that constrained code.
unconstrained fn capsule_side(this: AztecAddress) -> Option<u8> {
    capsules::load(this, MERCHANT_SIDE_SLOT, AztecAddress::zero()).map(|side: Field| {
        assert(side.lt(256), "Merchant side capsule is not a u8");
        side as u8
    })
}

struct Entry {
    merchant: bool,
    pending: bool,
}

// Mirrors the token's private read: the register's initialization nullifier, then the switch-off slot's value change
// (the first 2 * 1 + 1 fields of a DelayedPublicMutable<bool>) evaluated at the anchor's timestamp.
unconstrained fn probe(list: MerchantList, account: AztecAddress) -> Entry {
    let merchants: Map<AztecAddress, PublicImmutable<bool, ()>, ()> =
        Map::new((), list.merchants_slot);
    if !check_nullifier_exists(
        merchants.at(account).compute_initialization_inner_nullifier(),
    ) {
        Entry { merchant: false, pending: false }
    } else {
        let slot = derive_storage_slot_in_map(list.merchant_off_slot, account);
        let change =
            unpack_value_change::<bool, 1>(raw_storage_read(list.anchor.hash(), list.this, slot));
        let now = list.anchor.timestamp();
        let (_, change_at) = change.get_scheduled();
        Entry { merchant: !change.get_current_at(now), pending: change_at > now }
    }
}
