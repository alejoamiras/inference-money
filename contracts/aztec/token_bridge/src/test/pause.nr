// The owner's pause switch: who may flip it, and that it is a two-way toggle over claims, returns and exits.

use super::utils;
use crate::TokenBridge;
use aztec::{protocol::address::EthAddress, test::helpers::authwit::add_public_authwit_from_call};
use token::Token;

global NONCE: Field = 7;

#[test(should_fail_with = "Only owner")]
unconstrained fn non_owner_cannot_pause() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let stranger = env.create_light_account();
    env.call_public(stranger, TokenBridge::at(bridge).set_paused(true));
}

#[test]
unconstrained fn exits_resume_after_unpause() {
    let (mut env, admin, proxy, token, bridge) = utils::setup();
    let merchant = utils::merchant(&mut env, admin, token);
    utils::fund_public(env, merchant, 100_000, 42, bridge);

    env.call_public(admin, TokenBridge::at(bridge).set_paused(true));
    env.call_public(admin, TokenBridge::at(bridge).set_paused(false));
    add_public_authwit_from_call(env, merchant, proxy, Token::at(token).burn_public(merchant, 40_000, NONCE));
    env.call_public(
        merchant,
        TokenBridge::at(bridge).exit_to_l1_public(EthAddress::from_field(0xBEEF), 40_000, EthAddress::zero(), NONCE),
    );

    assert_eq(env.view_public(Token::at(token).balance_of_public(merchant)), 60_000);
}

/// Each write wins: after pause → unpause a claim goes through, and a re-pause blocks the next one.
#[test(should_fail_with = "Bridge is paused")]
unconstrained fn pause_state_tracks_toggles() {
    let (mut env, admin, _proxy, token, bridge) = utils::setup();
    let to = utils::merchant(&mut env, admin, token);

    env.call_public(admin, TokenBridge::at(bridge).set_paused(true));
    env.call_public(admin, TokenBridge::at(bridge).set_paused(false));
    utils::fund_public(env, to, 1_000, 1, bridge);
    assert_eq(env.view_public(Token::at(token).balance_of_public(to)), 1_000);

    env.call_public(admin, TokenBridge::at(bridge).set_paused(true));
    utils::fund_public(env, to, 1_000, 2, bridge);
}
