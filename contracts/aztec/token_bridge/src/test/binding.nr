// The funding-address binding: an account's first private claim binds it to that deposit's depositor, every later
// private claim must come from the same address, and the binding is set exactly once.

use super::utils;
use crate::TokenBridge;
use aztec::protocol::address::EthAddress;
use token::Token;

global OTHER: EthAddress = EthAddress::from_field(0xBAD);

#[test]
unconstrained fn the_first_claim_binds_its_depositor() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let user = env.create_contract_account();
    assert(utils::unbound(env, user, bridge));

    utils::fund_private(env, user, 100, 1, bridge);

    assert_eq(env.execute_utility(TokenBridge::at(bridge).get_funding_address(user)), utils::depositor());
}

#[test]
unconstrained fn a_later_deposit_from_the_funding_address_claims() {
    let (mut env, _admin, _proxy, token, bridge) = utils::setup();
    let user = env.create_contract_account();

    utils::fund_private(env, user, 100, 1, bridge);
    utils::fund_private(env, user, 250, 2, bridge);

    assert_eq(env.execute_utility(Token::at(token).balance_of_private(user)), 350);
}

#[test(should_fail_with = "Deposit is not from this account's funding address")]
unconstrained fn a_deposit_from_another_address_is_refused() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let user = env.create_contract_account();
    utils::fund_private(env, user, 100, 1, bridge);

    let leaf = utils::send_mint_to_private_message_from(env, user, 250, 2, OTHER, bridge);
    env.call_private(user, TokenBridge::at(bridge).claim_private(user, 250, 2, leaf, OTHER, false));
}

/// There is no second binding, from the same depositor or another: the binding's initialization nullifier repeats.
#[test(should_fail_with = "Attempted to emit duplicate siloed nullifier")]
unconstrained fn an_account_binds_only_once() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let user = env.create_contract_account();
    utils::fund_private(env, user, 100, 1, bridge);

    let leaf = utils::send_mint_to_private_message_from(env, user, 250, 2, OTHER, bridge);
    env.call_private(user, TokenBridge::at(bridge).claim_private(user, 250, 2, leaf, OTHER, true));
}

/// Skipping the first binding fails: an unbound account has no binding to match.
#[test(should_fail_with = "Failed to get a note")]
unconstrained fn an_unbound_account_must_bind() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let user = env.create_contract_account();

    let leaf = utils::send_mint_to_private_message_from(env, user, 100, 1, utils::depositor(), bridge);
    env.call_private(user, TokenBridge::at(bridge).claim_private(user, 100, 1, leaf, utils::depositor(), false));
}
