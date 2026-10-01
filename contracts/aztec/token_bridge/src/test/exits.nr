// Exits burn the sender's tokens and enqueue the L2→L1 withdraw. TXE has no outgoing-message oracle, so the burn is the
// assertion surface; the message content is pinned by the keystone + ContentHash.t.sol pair. A merchant exits publicly
// or privately to any address; a user exits only privately, and only to its funding address.

use super::utils;
use crate::TokenBridge;
use aztec::{
    protocol::address::EthAddress,
    test::helpers::authwit::{add_private_authwit_from_call, add_public_authwit_from_call},
};
use token::Token;

global NONCE: Field = 7;
global ELSEWHERE: EthAddress = EthAddress::from_field(0xCAFE);

#[test]
unconstrained fn a_merchant_exits_publicly_anywhere() {
    let (mut env, admin, proxy, token, bridge) = utils::setup();
    let merchant = utils::merchant(&mut env, admin, token);
    utils::fund_public(env, merchant, 2_000_000, 42, bridge);

    add_public_authwit_from_call(env, merchant, proxy, Token::at(token).burn_public(merchant, 700_000, NONCE));
    env.call_public(
        merchant,
        TokenBridge::at(bridge).exit_to_l1_public(ELSEWHERE, 700_000, EthAddress::zero(), NONCE),
    );

    assert_eq(env.view_public(Token::at(token).balance_of_public(merchant)), 1_300_000);
}

/// Refused before the burn, so the authwit and balance never matter.
#[test(should_fail_with = "Public exits are for merchants only")]
unconstrained fn a_user_cannot_exit_publicly() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let user = env.create_light_account();
    env.call_public(user, TokenBridge::at(bridge).exit_to_l1_public(ELSEWHERE, 1, EthAddress::zero(), NONCE));
}

#[test]
unconstrained fn a_user_exits_privately_to_its_funding_address() {
    let (mut env, _admin, proxy, token, bridge) = utils::setup();
    let user = env.create_contract_account();
    utils::fund_private(env, user, 900_000, 555, bridge);

    add_private_authwit_from_call(env, user, proxy, Token::at(token).burn_private(user, 400_000, NONCE));
    env.call_private(
        user,
        TokenBridge::at(bridge).exit_to_l1_private(utils::depositor(), 400_000, EthAddress::zero(), NONCE, false),
    );

    assert_eq(env.execute_utility(Token::at(token).balance_of_private(user)), 500_000);
}

#[test(should_fail_with = "Withdrawals from a user account go only to its funding address")]
unconstrained fn a_user_cannot_exit_elsewhere() {
    let (mut env, _admin, proxy, token, bridge) = utils::setup();
    let user = env.create_contract_account();
    utils::fund_private(env, user, 900_000, 555, bridge);

    add_private_authwit_from_call(env, user, proxy, Token::at(token).burn_private(user, 400_000, NONCE));
    env.call_private(user, TokenBridge::at(bridge).exit_to_l1_private(ELSEWHERE, 400_000, EthAddress::zero(), NONCE, false));
}

/// An account that never claimed has no funding address, so it cannot exit at all; refused before any note is read.
#[test(should_fail_with = "Withdrawals from a user account go only to its funding address")]
unconstrained fn an_unbound_user_cannot_exit() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let user = env.create_contract_account();
    env.call_private(
        user,
        TokenBridge::at(bridge).exit_to_l1_private(utils::depositor(), 1, EthAddress::zero(), NONCE, false),
    );
}

#[test(should_fail_with = "Withdrawals from a user account go only to its funding address")]
unconstrained fn a_user_cannot_exit_as_a_merchant() {
    let (mut env, _admin, proxy, token, bridge) = utils::setup();
    let user = env.create_contract_account();
    utils::fund_private(env, user, 900_000, 555, bridge);

    add_private_authwit_from_call(env, user, proxy, Token::at(token).burn_private(user, 400_000, NONCE));
    env.call_private(user, TokenBridge::at(bridge).exit_to_l1_private(ELSEWHERE, 400_000, EthAddress::zero(), NONCE, true));
}

/// A merchant's binding does not limit it: listed, it exits privately to an address other than its funding address.
#[test]
unconstrained fn a_merchant_exits_privately_anywhere() {
    let (mut env, admin, proxy, token, bridge) = utils::setup();
    let merchant = utils::merchant(&mut env, admin, token);
    utils::fund_private(env, merchant, 900_000, 555, bridge);

    add_private_authwit_from_call(env, merchant, proxy, Token::at(token).burn_private(merchant, 400_000, NONCE));
    env.call_private(
        merchant,
        TokenBridge::at(bridge).exit_to_l1_private(ELSEWHERE, 400_000, EthAddress::zero(), NONCE, true),
    );

    assert_eq(env.execute_utility(Token::at(token).balance_of_private(merchant)), 500_000);
}

#[test(should_fail_with = "Bridge is paused")]
unconstrained fn exit_to_l1_public_paused_rejected() {
    let (mut env, admin, _proxy, token, bridge) = utils::setup();
    let merchant = utils::merchant(&mut env, admin, token);

    env.call_public(admin, TokenBridge::at(bridge).set_paused(true));
    env.call_public(merchant, TokenBridge::at(bridge).exit_to_l1_public(ELSEWHERE, 1, EthAddress::zero(), NONCE));
}

/// Funded and authorized before pausing: the private exit's pause gate runs in the ENQUEUED public assert, so the
/// private phase (binding, note nullification, authwit) must succeed first or the test proves nothing about pause.
#[test(should_fail_with = "Bridge is paused")]
unconstrained fn exit_to_l1_private_paused_rejected() {
    let (mut env, admin, proxy, token, bridge) = utils::setup();
    let user = env.create_contract_account();
    utils::fund_private(env, user, 500_000, 4242, bridge);

    add_private_authwit_from_call(env, user, proxy, Token::at(token).burn_private(user, 1, NONCE));
    env.call_public(admin, TokenBridge::at(bridge).set_paused(true));
    env.call_private(
        user,
        TokenBridge::at(bridge).exit_to_l1_private(utils::depositor(), 1, EthAddress::zero(), NONCE, false),
    );
}

#[test(should_fail_with = "Recipient cannot be zero")]
unconstrained fn exit_to_l1_public_zero_recipient_rejected() {
    let (mut env, admin, _proxy, token, bridge) = utils::setup();
    let merchant = utils::merchant(&mut env, admin, token);
    env.call_public(
        merchant,
        TokenBridge::at(bridge).exit_to_l1_public(EthAddress::zero(), 1, EthAddress::zero(), NONCE),
    );
}

#[test(should_fail_with = "Recipient cannot be zero")]
unconstrained fn exit_to_l1_private_zero_recipient_rejected() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let user = env.create_contract_account();
    env.call_private(
        user,
        TokenBridge::at(bridge).exit_to_l1_private(EthAddress::zero(), 1, EthAddress::zero(), NONCE, false),
    );
}

/// The portal's payout must lower its own balance, so a withdraw to itself could never land: refused before the burn.
#[test(should_fail_with = "Recipient cannot be the portal")]
unconstrained fn exit_to_l1_public_portal_recipient_rejected() {
    let (mut env, admin, _proxy, token, bridge) = utils::setup();
    let merchant = utils::merchant(&mut env, admin, token);
    env.call_public(merchant, TokenBridge::at(bridge).exit_to_l1_public(utils::portal(), 1, EthAddress::zero(), NONCE));
}

#[test(should_fail_with = "Recipient cannot be the portal")]
unconstrained fn exit_to_l1_private_portal_recipient_rejected() {
    let (mut env, admin, _proxy, token, bridge) = utils::setup();
    let merchant = utils::merchant(&mut env, admin, token);
    env.call_private(
        merchant,
        TokenBridge::at(bridge).exit_to_l1_private(utils::portal(), 1, EthAddress::zero(), NONCE, true),
    );
}

/// Exiting more than the sender holds fails on the burn, never emitting a withdraw for value that was not destroyed.
#[test(should_fail_with = "attempt to subtract with overflow")]
unconstrained fn exit_to_l1_public_insufficient_balance_rejected() {
    let (mut env, admin, proxy, token, bridge) = utils::setup();
    let merchant = utils::merchant(&mut env, admin, token);
    utils::fund_public(env, merchant, 100_000, 42, bridge);

    add_public_authwit_from_call(env, merchant, proxy, Token::at(token).burn_public(merchant, 100_001, NONCE));
    env.call_public(
        merchant,
        TokenBridge::at(bridge).exit_to_l1_public(ELSEWHERE, 100_001, EthAddress::zero(), NONCE),
    );
}

/// The private twin: the burn nullifies notes, so it must fail rather than exit one balance twice.
#[test(should_fail_with = "Balance too low")]
unconstrained fn exit_to_l1_private_insufficient_balance_rejected() {
    let (mut env, _admin, proxy, token, bridge) = utils::setup();
    let user = env.create_contract_account();
    utils::fund_private(env, user, 100_000, 8675309, bridge);

    add_private_authwit_from_call(env, user, proxy, Token::at(token).burn_private(user, 100_001, NONCE));
    env.call_private(
        user,
        TokenBridge::at(bridge).exit_to_l1_private(utils::depositor(), 100_001, EthAddress::zero(), NONCE, false),
    );
}

/// The proxy burns on the sender's behalf, so the sender's authwit is the only thing authorizing it.
#[test(should_fail_with = "unauthorized")]
unconstrained fn exit_public_without_authwit_rejected() {
    let (mut env, admin, _proxy, token, bridge) = utils::setup();
    let merchant = utils::merchant(&mut env, admin, token);
    utils::fund_public(env, merchant, 100_000, 42, bridge);

    env.call_public(merchant, TokenBridge::at(bridge).exit_to_l1_public(ELSEWHERE, 50_000, EthAddress::zero(), NONCE));
}

/// Private twin: the missing witness surfaces when the token asks the oracle for it during private execution.
#[test(should_fail_with = "Unknown auth witness for message hash")]
unconstrained fn exit_private_without_authwit_rejected() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let user = env.create_contract_account();
    utils::fund_private(env, user, 100_000, 31337, bridge);

    env.call_private(
        user,
        TokenBridge::at(bridge).exit_to_l1_private(utils::depositor(), 50_000, EthAddress::zero(), NONCE, false),
    );
}

#[test(should_fail_with = "Amount must be greater than zero")]
unconstrained fn exit_public_zero_amount_rejected() {
    let (mut env, admin, _proxy, token, bridge) = utils::setup();
    let merchant = utils::merchant(&mut env, admin, token);
    env.call_public(merchant, TokenBridge::at(bridge).exit_to_l1_public(ELSEWHERE, 0, EthAddress::zero(), NONCE));
}

#[test(should_fail_with = "Amount must be greater than zero")]
unconstrained fn exit_private_zero_amount_rejected() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let user = env.create_contract_account();
    env.call_private(
        user,
        TokenBridge::at(bridge).exit_to_l1_private(utils::depositor(), 0, EthAddress::zero(), NONCE, false),
    );
}
