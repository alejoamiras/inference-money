// The token's #[only_self] helpers are reachable only through its own enqueued calls, whoever calls them directly. Each
// probe passes arguments under which the body itself would succeed, so only the only_self check can make it fail.

use crate::{test::utils, Token};

#[test(should_fail_with = "can only be called by the same contract")]
unconstrained fn increase_public_balance_internal_rejects_a_user() {
    let w = utils::setup_merchant_world(false);
    w.env.call_public(w.alice, Token::at(w.token).increase_public_balance_internal(w.alice, 1));
}

#[test(should_fail_with = "can only be called by the same contract")]
unconstrained fn decrease_public_balance_internal_rejects_a_merchant() {
    let w = utils::setup_merchant_world(false);
    w.env.call_public(w.m1, Token::at(w.token).decrease_public_balance_internal(w.alice, 1));
}

#[test(should_fail_with = "can only be called by the same contract")]
unconstrained fn increase_total_supply_internal_rejects_a_stranger() {
    let w = utils::setup_merchant_world(false);
    w.env.call_public(w.bob, Token::at(w.token).increase_total_supply_internal(1));
}

#[test(should_fail_with = "can only be called by the same contract")]
unconstrained fn decrease_total_supply_internal_rejects_the_minter() {
    let w = utils::setup_merchant_world(false);
    w.env.call_public(w.minter, Token::at(w.token).decrease_total_supply_internal(1));
}

#[test(should_fail_with = "can only be called by the same contract")]
unconstrained fn recurse_subtract_balance_internal_rejects_the_owner() {
    let w = utils::setup_merchant_world(false);
    let _ = w.env.call_private(
        w.alice,
        Token::at(w.token).recurse_subtract_balance_internal(w.alice, 1),
    );
}
