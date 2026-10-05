// The transfer rule: a private transfer needs a merchant on at least one side, judged on `from` and `to`, unless it
// shields an account's own public tokens.
use crate::{test::utils::{self, mint_amount}, Token};
use aztec::test::helpers::authwit as authwit_cheatcodes;
use generic_proxy::GenericProxy;

global AMOUNT: u128 = 100;
global DAY: u64 = 86400;

#[test(should_fail_with = "Transfer refused: neither sender nor recipient is a merchant")]
unconstrained fn user_to_user_private_to_private_is_refused() {
    let w = utils::setup_merchant_world(false);
    w.env.call_private(
        w.alice,
        Token::at(w.token).transfer_private_to_private(w.alice, w.bob, AMOUNT, 0),
    );
}

#[test(should_fail_with = "Transfer refused: neither sender nor recipient is a merchant")]
unconstrained fn user_to_user_private_to_public_is_refused() {
    let w = utils::setup_merchant_world(false);
    w.env.call_private(
        w.alice,
        Token::at(w.token).transfer_private_to_public(w.alice, w.bob, AMOUNT, 0),
    );
}

#[test(should_fail_with = "Transfer refused: neither sender nor recipient is a merchant")]
unconstrained fn user_to_user_public_to_private_is_refused() {
    let w = utils::setup_merchant_world(false);
    w.env.call_private(
        w.alice,
        Token::at(w.token).transfer_public_to_private(w.alice, w.bob, AMOUNT, 0),
    );
}

#[test(should_fail_with = "Transfer refused: neither sender nor recipient is a merchant")]
unconstrained fn user_to_user_private_to_public_with_commitment_is_refused() {
    let w = utils::setup_merchant_world(false);
    let _ = w.env.call_private(
        w.alice,
        Token::at(w.token).transfer_private_to_public_with_commitment(w.alice, w.bob, AMOUNT, 0),
    );
}

// A shield to another user is refused above; to oneself it needs no merchant, so an ex-merchant's public float is not
// stranded.
#[test]
unconstrained fn a_user_and_an_ex_merchant_shield_their_own_funds() {
    let w = utils::setup_merchant_world(false);
    utils::anchor_at(w.env, utils::switch_off(w, w.m1));
    let token = Token::at(w.token);
    for holder in [w.alice, w.m1] {
        w.env.call_private(holder, token.transfer_public_to_private(holder, holder, AMOUNT, 0));
        utils::check_public_balance(w.env, w.token, holder, mint_amount - AMOUNT);
        utils::check_private_balance(w.env, w.token, holder, mint_amount + AMOUNT);
    }
}

#[test(should_fail_with = "Transfer refused: neither sender nor recipient is a merchant")]
unconstrained fn a_user_cannot_unshield_its_own_funds() {
    let w = utils::setup_merchant_world(false);
    w.env.call_private(
        w.alice,
        Token::at(w.token).transfer_private_to_public(w.alice, w.alice, AMOUNT, 0),
    );
}

#[test]
unconstrained fn a_user_pays_a_merchant_through_every_private_entry_point() {
    let w = utils::setup_merchant_world(false);
    let token = Token::at(w.token);
    w.env.call_private(w.alice, token.transfer_private_to_private(w.alice, w.m1, AMOUNT, 0));
    w.env.call_private(w.alice, token.transfer_private_to_public(w.alice, w.m1, AMOUNT, 0));
    w.env.call_private(w.alice, token.transfer_public_to_private(w.alice, w.m1, AMOUNT, 0));
    utils::check_private_balance(w.env, w.token, w.alice, mint_amount - 2 * AMOUNT);
    utils::check_private_balance(w.env, w.token, w.m1, mint_amount + 2 * AMOUNT);
    utils::check_public_balance(w.env, w.token, w.m1, mint_amount + AMOUNT);
    utils::check_public_balance(w.env, w.token, w.alice, mint_amount - AMOUNT);
}

#[test]
unconstrained fn a_merchant_pays_a_user_through_every_private_entry_point() {
    let w = utils::setup_merchant_world(false);
    let token = Token::at(w.token);
    w.env.call_private(w.m1, token.transfer_private_to_private(w.m1, w.bob, AMOUNT, 0));
    w.env.call_private(w.m1, token.transfer_private_to_public(w.m1, w.bob, AMOUNT, 0));
    w.env.call_private(w.m1, token.transfer_public_to_private(w.m1, w.bob, AMOUNT, 0));
    utils::check_private_balance(w.env, w.token, w.bob, 2 * AMOUNT);
    utils::check_public_balance(w.env, w.token, w.bob, AMOUNT);
}

#[test]
unconstrained fn merchants_pay_each_other_and_move_their_own_funds() {
    let w = utils::setup_merchant_world(false);
    let token = Token::at(w.token);
    w.env.call_private(w.m1, token.transfer_private_to_private(w.m1, w.m2, AMOUNT, 0));
    w.env.call_private(w.m1, token.transfer_private_to_public(w.m1, w.m1, AMOUNT, 0));
    w.env.call_private(w.m1, token.transfer_public_to_private(w.m1, w.m1, AMOUNT, 0));
    utils::check_private_balance(w.env, w.token, w.m2, mint_amount + AMOUNT);
    utils::check_private_balance(w.env, w.token, w.m1, mint_amount - AMOUNT);
    utils::check_public_balance(w.env, w.token, w.m1, mint_amount);
}

#[test]
unconstrained fn a_merchant_being_switched_off_is_still_one_before_the_delay() {
    let w = utils::setup_merchant_world(false);
    let t0 = w.env.last_block_timestamp();
    w.env.call_public(w.admin, Token::at(w.token).schedule_merchant_off(w.m1, true));
    // The proof reads the pending change and expires just before it applies, so it lands before then.
    utils::anchor_at(w.env, t0 + DAY - 1000);
    w.env.call_private(
        w.alice,
        Token::at(w.token).transfer_private_to_private(w.alice, w.m1, AMOUNT, 0),
    );
    utils::check_private_balance(w.env, w.token, w.m1, mint_amount + AMOUNT);
}

#[test(should_fail_with = "Transfer refused: neither sender nor recipient is a merchant")]
unconstrained fn a_switched_off_merchant_is_a_user_once_the_delay_has_passed() {
    let w = utils::setup_merchant_world(false);
    let t0 = w.env.last_block_timestamp();
    w.env.call_public(w.admin, Token::at(w.token).schedule_merchant_off(w.m1, true));
    utils::anchor_at(w.env, t0 + DAY);
    w.env.call_private(
        w.alice,
        Token::at(w.token).transfer_private_to_private(w.alice, w.m1, AMOUNT, 0),
    );
}

#[test]
unconstrained fn a_delegated_payment_to_a_merchant_is_allowed() {
    let w = utils::setup_merchant_world(true);
    let mut env = w.env;
    let proxy = env.deploy("@generic_proxy/GenericProxy").without_initializer();
    let call = Token::at(w.token).transfer_private_to_private(w.alice, w.m1, AMOUNT, 1);
    authwit_cheatcodes::add_private_authwit_from_call(env, w.alice, proxy, call);
    env.call_private(
        w.alice,
        GenericProxy::at(proxy).forward_private_4(call.target_contract, call.selector, call.args),
    );
    utils::check_private_balance(env, w.token, w.m1, mint_amount + AMOUNT);
}

// The rule reads `from` and `to`, never the caller: a listed caller moving a user's funds to a user is refused.
#[test(should_fail_with = "Transfer refused: neither sender nor recipient is a merchant")]
unconstrained fn a_delegated_transfer_is_judged_on_from_not_the_caller() {
    let w = utils::setup_merchant_world(true);
    let mut env = w.env;
    let proxy = env.deploy("@generic_proxy/GenericProxy").without_initializer();
    utils::list_merchants(env, w.token, w.admin, [proxy]);
    let call = Token::at(w.token).transfer_private_to_private(w.alice, w.bob, AMOUNT, 1);
    authwit_cheatcodes::add_private_authwit_from_call(env, w.alice, proxy, call);
    env.call_private(
        w.alice,
        GenericProxy::at(proxy).forward_private_4(call.target_contract, call.selector, call.args),
    );
}

// `#[authorize_once]` runs before the function body, so an unauthorized delegated call never reaches the rule.
#[test(should_fail_with = "Unknown auth witness for message hash")]
unconstrained fn a_delegated_call_without_an_authwit_fails_authorization_first() {
    let w = utils::setup_merchant_world(true);
    let mut env = w.env;
    let proxy = env.deploy("@generic_proxy/GenericProxy").without_initializer();
    let call = Token::at(w.token).transfer_private_to_private(w.alice, w.bob, AMOUNT, 1);
    env.call_private(
        w.alice,
        GenericProxy::at(proxy).forward_private_4(call.target_contract, call.selector, call.args),
    );
}

#[test]
unconstrained fn public_to_public_is_unrestricted() {
    let w = utils::setup_merchant_world(false);
    w.env.call_public(
        w.alice,
        Token::at(w.token).transfer_public_to_public(w.alice, w.bob, AMOUNT, 0),
    );
    utils::check_public_balance(w.env, w.token, w.bob, AMOUNT);
}

// Only mints and burns write the total supply: every transfer kind, a request and its payment, list calls and
// cancel_authwit move value only between their own parties, and a bystander's balances never move.
#[test]
unconstrained fn no_transfer_or_request_moves_the_total_supply() {
    let w = utils::setup_merchant_world(false);
    let token = Token::at(w.token);
    let supply = utils::get_total_supply(w.env, w.token);
    w.env.call_private(w.alice, token.transfer_private_to_private(w.alice, w.m1, AMOUNT, 0));
    w.env.call_private(w.m1, token.transfer_private_to_public(w.m1, w.m2, AMOUNT, 0));
    w.env.call_private(w.m2, token.transfer_public_to_private(w.m2, w.alice, AMOUNT, 0));
    w.env.call_public(w.alice, token.transfer_public_to_public(w.alice, w.m1, AMOUNT, 0));
    let c = w.env.call_private(w.alice, token.initialize_transfer_commitment(w.m1, w.alice));
    w.env.call_private(w.alice, token.transfer_private_to_commitment(w.alice, c, AMOUNT, 0));
    w.env.call_public(w.admin, token.add_merchant(w.bob));
    w.env.call_public(w.admin, token.schedule_merchant_off(w.bob, true));
    w.env.call_private(w.alice, token.cancel_authwit(0));

    utils::check_total_supply(w.env, w.token, supply);
    utils::check_private_balance(w.env, w.token, w.alice, mint_amount - AMOUNT);
    utils::check_public_balance(w.env, w.token, w.alice, mint_amount - AMOUNT);
    utils::check_private_balance(w.env, w.token, w.m1, mint_amount + AMOUNT);
    utils::check_public_balance(w.env, w.token, w.m1, mint_amount + AMOUNT);
    utils::check_private_balance(w.env, w.token, w.m2, mint_amount);
    utils::check_public_balance(w.env, w.token, w.m2, mint_amount);
    utils::check_private_balance(w.env, w.token, w.bob, 0);
    utils::check_public_balance(w.env, w.token, w.bob, 0);
}
