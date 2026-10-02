// Returns: a deposit nobody may claim goes back to its depositor and mints nothing. TXE has no outgoing-message oracle,
// so the payout's content is pinned by the keystone's withdraw vector and its L1 payout by integration; here a return
// consumes its message without moving supply, and a message is returned or claimed once.

use super::utils;
use crate::TokenBridge;
use aztec::protocol::address::EthAddress;
use token::Token;

#[test]
unconstrained fn a_private_return_consumes_the_deposit_and_mints_nothing() {
    let (mut env, _admin, _proxy, token, bridge) = utils::setup();
    let recipient = env.create_contract_account();
    let anyone = env.create_contract_account();
    let leaf = utils::send_mint_to_private_message_from(env, recipient, 500_000, 5, utils::depositor(), bridge);
    let supply = env.view_public(Token::at(token).total_supply());

    env.call_private(
        anyone,
        TokenBridge::at(bridge).return_deposit_private(recipient, 500_000, 5, leaf, utils::depositor()),
    );

    assert_eq(env.view_public(Token::at(token).total_supply()), supply);
    assert_eq(env.execute_utility(Token::at(token).balance_of_private(recipient)), 0);
    assert(utils::unbound(env, recipient, bridge));
}

#[test(should_fail_with = "No non-nullified L1 to L2 message found")]
unconstrained fn a_returned_private_deposit_cannot_be_claimed() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let recipient = env.create_contract_account();
    let leaf = utils::send_mint_to_private_message_from(env, recipient, 500_000, 5, utils::depositor(), bridge);

    env.call_private(
        recipient,
        TokenBridge::at(bridge).return_deposit_private(recipient, 500_000, 5, leaf, utils::depositor()),
    );
    env.call_private(
        recipient,
        TokenBridge::at(bridge).claim_private(recipient, 500_000, 5, leaf, utils::depositor(), true),
    );
}

#[test(should_fail_with = "No non-nullified L1 to L2 message found")]
unconstrained fn a_claimed_private_deposit_cannot_be_returned() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let recipient = env.create_contract_account();
    let leaf = utils::send_mint_to_private_message_from(env, recipient, 500_000, 5, utils::depositor(), bridge);

    env.call_private(
        recipient,
        TokenBridge::at(bridge).claim_private(recipient, 500_000, 5, leaf, utils::depositor(), true),
    );
    env.call_private(
        recipient,
        TokenBridge::at(bridge).return_deposit_private(recipient, 500_000, 5, leaf, utils::depositor()),
    );
}

#[test(should_fail_with = "No non-nullified L1 to L2 message found")]
unconstrained fn a_private_deposit_is_returned_once() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let recipient = env.create_contract_account();
    let leaf = utils::send_mint_to_private_message_from(env, recipient, 500_000, 5, utils::depositor(), bridge);
    let ret = TokenBridge::at(bridge).return_deposit_private(recipient, 500_000, 5, leaf, utils::depositor());

    env.call_private(recipient, ret);
    env.call_private(recipient, ret);
}

/// The return pays the depositor the message names, so naming another consumes nothing.
#[test(should_fail_with = "No L1 to L2 message found")]
unconstrained fn a_return_to_another_depositor_consumes_nothing() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let recipient = env.create_contract_account();
    let leaf = utils::send_mint_to_private_message_from(env, recipient, 500_000, 5, utils::depositor(), bridge);

    let thief = EthAddress::from_field(0xBAD);
    env.call_private(recipient, TokenBridge::at(bridge).return_deposit_private(recipient, 500_000, 5, leaf, thief));
}

#[test]
unconstrained fn a_public_deposit_to_a_user_is_returned_and_mints_nothing() {
    let (mut env, _admin, _proxy, token, bridge) = utils::setup();
    let user = env.create_light_account();
    let anyone = env.create_light_account();
    let leaf = utils::send_mint_to_public_message(env, user, 1_000, 3, bridge);
    let supply = env.view_public(Token::at(token).total_supply());

    env.call_public(anyone, TokenBridge::at(bridge).return_deposit_public(user, 1_000, 3, leaf, utils::depositor()));

    assert_eq(env.view_public(Token::at(token).total_supply()), supply);
    assert_eq(env.view_public(Token::at(token).balance_of_public(user)), 0);
}

/// A merchant's public claim secret is visible in the mempool, so its deposit can't be bounced: it is claimed only.
#[test(should_fail_with = "A merchant's public deposit is claimed, not returned")]
unconstrained fn a_public_deposit_to_a_merchant_is_not_returned() {
    let (mut env, admin, _proxy, token, bridge) = utils::setup();
    let merchant = utils::merchant(&mut env, admin, token);
    let leaf = utils::send_mint_to_public_message(env, merchant, 1_000, 3, bridge);

    env.call_public(merchant, TokenBridge::at(bridge).return_deposit_public(merchant, 1_000, 3, leaf, utils::depositor()));
}

#[test(should_fail_with = "L1-to-L2 message is already nullified")]
unconstrained fn a_public_deposit_is_returned_once() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let user = env.create_light_account();
    let leaf = utils::send_mint_to_public_message(env, user, 1_000, 3, bridge);
    let ret = TokenBridge::at(bridge).return_deposit_public(user, 1_000, 3, leaf, utils::depositor());

    env.call_public(user, ret);
    env.call_public(user, ret);
}

#[test(should_fail_with = "Bridge is paused")]
unconstrained fn a_paused_bridge_refuses_private_returns() {
    let (mut env, admin, _proxy, _token, bridge) = utils::setup();
    let recipient = env.create_contract_account();
    let leaf = utils::send_mint_to_private_message_from(env, recipient, 500_000, 5, utils::depositor(), bridge);

    env.call_public(admin, TokenBridge::at(bridge).set_paused(true));
    env.call_private(
        recipient,
        TokenBridge::at(bridge).return_deposit_private(recipient, 500_000, 5, leaf, utils::depositor()),
    );
}

#[test(should_fail_with = "Bridge is paused")]
unconstrained fn a_paused_bridge_refuses_public_returns() {
    let (mut env, admin, _proxy, _token, bridge) = utils::setup();
    let user = env.create_light_account();
    let leaf = utils::send_mint_to_public_message(env, user, 1_000, 3, bridge);

    env.call_public(admin, TokenBridge::at(bridge).set_paused(true));
    env.call_public(user, TokenBridge::at(bridge).return_deposit_public(user, 1_000, 3, leaf, utils::depositor()));
}
