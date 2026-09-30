// The request rule: opening a request needs a merchant on one side, and records which with a stamp or a pad; a user
// may pay only into a stamped request (opened for a merchant), a merchant into any.
use crate::{test::utils::{self, MerchantWorld, mint_amount}, Token};
use merchant_stamp::{pad, stamp};

global AMOUNT: u128 = 100;
global DAY: u64 = 86400;

unconstrained fn has_nullifier(w: MerchantWorld, nullifier: Field) -> bool {
    w.env.public_context(|context| context.nullifier_exists_unsafe(nullifier, w.token))
}

unconstrained fn assert_stamped(w: MerchantWorld, commitment: Field) {
    assert(has_nullifier(w, stamp(commitment)), "request should be stamped");
    assert(!has_nullifier(w, pad(commitment)), "a stamped request should not be padded");
}

unconstrained fn assert_padded(w: MerchantWorld, commitment: Field) {
    assert(has_nullifier(w, pad(commitment)), "request should be padded");
    assert(!has_nullifier(w, stamp(commitment)), "a padded request should not be stamped");
}

#[test]
unconstrained fn a_request_a_user_opens_for_a_merchant_is_stamped() {
    let w = utils::setup_merchant_world(false);
    let c = w.env.call_private(
        w.alice,
        Token::at(w.token).initialize_transfer_commitment(w.m1, w.alice),
    );
    assert_stamped(w, c);
}

#[test]
unconstrained fn a_request_a_merchant_opens_for_a_user_is_padded() {
    let w = utils::setup_merchant_world(false);
    let c =
        w.env.call_private(w.m1, Token::at(w.token).initialize_transfer_commitment(w.alice, w.m1));
    assert_padded(w, c);
}

// A merchant recipient is always proven when opening, so a merchant's request is never padded.
#[test]
unconstrained fn a_request_a_merchant_opens_for_a_merchant_is_stamped() {
    let w = utils::setup_merchant_world(false);
    let c = w.env.call_private(w.m1, Token::at(w.token).initialize_transfer_commitment(w.m2, w.m1));
    assert_stamped(w, c);
}

#[test(should_fail_with = "Request refused: neither creator nor recipient is a merchant")]
unconstrained fn a_user_cannot_open_a_request_for_a_user() {
    let w = utils::setup_merchant_world(false);
    let _ = w.env.call_private(
        w.alice,
        Token::at(w.token).initialize_transfer_commitment(w.bob, w.alice),
    );
}

#[test]
unconstrained fn with_commitment_to_a_merchant_is_stamped_and_from_a_merchant_padded() {
    let w = utils::setup_merchant_world(false);
    let token = Token::at(w.token);
    let to_merchant = w.env.call_private(
        w.alice,
        token.transfer_private_to_public_with_commitment(w.alice, w.m1, AMOUNT, 0),
    );
    assert_stamped(w, to_merchant);
    let to_user = w.env.call_private(
        w.m1,
        token.transfer_private_to_public_with_commitment(w.m1, w.bob, AMOUNT, 0),
    );
    assert_padded(w, to_user);
    utils::check_public_balance(w.env, w.token, w.bob, AMOUNT);
}

#[test]
unconstrained fn a_user_pays_a_merchants_request_privately() {
    let w = utils::setup_merchant_world(false);
    let token = Token::at(w.token);
    let c = w.env.call_private(w.alice, token.initialize_transfer_commitment(w.m1, w.alice));
    w.env.call_private(w.alice, token.transfer_private_to_commitment(w.alice, c, AMOUNT, 0));
    utils::check_private_balance(w.env, w.token, w.m1, mint_amount + AMOUNT);
    utils::check_private_balance(w.env, w.token, w.alice, mint_amount - AMOUNT);
}

// A merchant cannot open a request for Carol that Bob, a user, then pays: Bob paying Carol is user to user.
#[test(should_fail_with = "Payment refused: users may only pay into requests opened for a merchant")]
unconstrained fn a_user_cannot_pay_a_request_opened_for_a_user() {
    let w = utils::setup_merchant_world(false);
    let (carol, bob) = (w.alice, w.bob);
    utils::mint_to_private(w.env, w.token, bob, mint_amount, w.minter);
    let token = Token::at(w.token);
    let c = w.env.call_private(w.m1, token.initialize_transfer_commitment(carol, bob));
    w.env.call_private(bob, token.transfer_private_to_commitment(bob, c, AMOUNT, 0));
}

#[test]
unconstrained fn a_merchant_pays_an_unstamped_request() {
    let w = utils::setup_merchant_world(false);
    let token = Token::at(w.token);
    let c = w.env.call_private(w.m1, token.initialize_transfer_commitment(w.bob, w.m2));
    w.env.call_private(w.m2, token.transfer_private_to_commitment(w.m2, c, AMOUNT, 0));
    utils::check_private_balance(w.env, w.token, w.bob, AMOUNT);
}

#[test]
unconstrained fn a_user_pays_a_merchants_request_publicly() {
    let w = utils::setup_merchant_world(false);
    let token = Token::at(w.token);
    let c = w.env.call_private(w.alice, token.initialize_transfer_commitment(w.m1, w.alice));
    w.env.call_public(w.alice, token.transfer_public_to_commitment(w.alice, c, AMOUNT, 0));
    utils::check_private_balance(w.env, w.token, w.m1, mint_amount + AMOUNT);
    utils::check_public_balance(w.env, w.token, w.alice, mint_amount - AMOUNT);
}

#[test(should_fail_with = "Payment refused: users may only pay into requests opened for a merchant")]
unconstrained fn a_user_cannot_pay_a_request_opened_for_a_user_publicly() {
    let w = utils::setup_merchant_world(false);
    let token = Token::at(w.token);
    let c = w.env.call_private(w.m1, token.initialize_transfer_commitment(w.bob, w.alice));
    w.env.call_public(w.alice, token.transfer_public_to_commitment(w.alice, c, AMOUNT, 0));
}

#[test]
unconstrained fn a_merchant_pays_an_unstamped_request_publicly() {
    let w = utils::setup_merchant_world(false);
    let token = Token::at(w.token);
    let c = w.env.call_private(w.m1, token.initialize_transfer_commitment(w.bob, w.m2));
    w.env.call_public(w.m2, token.transfer_public_to_commitment(w.m2, c, AMOUNT, 0));
    utils::check_private_balance(w.env, w.token, w.bob, AMOUNT);
}

// Accepted residual: a stamp records who the request was opened for at the time, so switching that merchant off
// later does not revoke it.
#[test]
unconstrained fn a_request_stamped_for_a_merchant_stays_payable_after_its_switch_off() {
    let w = utils::setup_merchant_world(false);
    let token = Token::at(w.token);
    let c = w.env.call_private(w.alice, token.initialize_transfer_commitment(w.m1, w.alice));
    let t0 = w.env.last_block_timestamp();
    w.env.call_public(w.admin, token.schedule_merchant_off(w.m1, true));
    utils::anchor_at(w.env, t0 + DAY);
    assert(!w.env.view_public(token.is_merchant(w.m1)));
    w.env.call_private(w.alice, token.transfer_private_to_commitment(w.alice, c, AMOUNT, 0));
    utils::check_private_balance(w.env, w.token, w.m1, mint_amount + AMOUNT);
}
