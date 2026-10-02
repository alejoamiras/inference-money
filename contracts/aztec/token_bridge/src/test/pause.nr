// The owner's pause switch: who may flip it, and that it is a two-way toggle over both claims and exits.

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
    let user = env.create_light_account();
    let leaf = utils::send_mint_to_public_message(env, user, 100_000, 42, bridge);
    env.call_public(user, TokenBridge::at(bridge).claim_public(user, 100_000, 42, leaf, utils::depositor()));

    env.call_public(admin, TokenBridge::at(bridge).set_paused(true));
    env.call_public(admin, TokenBridge::at(bridge).set_paused(false));
    add_public_authwit_from_call(env, user, proxy, Token::at(token).burn_public(user, 40_000, NONCE));
    env.call_public(
        user,
        TokenBridge::at(bridge).exit_to_l1_public(EthAddress::from_field(0xBEEF), 40_000, EthAddress::zero(), NONCE),
    );

    assert_eq(env.view_public(Token::at(token).balance_of_public(user)), 60_000);
}

/// Each write wins: after pause → unpause a claim goes through, and a re-pause blocks the next one.
#[test(should_fail_with = "Bridge is paused")]
unconstrained fn pause_state_tracks_toggles() {
    let (mut env, admin, _proxy, token, bridge) = utils::setup();
    let to = env.create_light_account();

    env.call_public(admin, TokenBridge::at(bridge).set_paused(true));
    env.call_public(admin, TokenBridge::at(bridge).set_paused(false));
    let first = utils::send_mint_to_public_message(env, to, 1_000, 1, bridge);
    env.call_public(to, TokenBridge::at(bridge).claim_public(to, 1_000, 1, first, utils::depositor()));
    assert_eq(env.view_public(Token::at(token).balance_of_public(to)), 1_000);

    env.call_public(admin, TokenBridge::at(bridge).set_paused(true));
    let second = utils::send_mint_to_public_message(env, to, 1_000, 2, bridge);
    env.call_public(to, TokenBridge::at(bridge).claim_public(to, 1_000, 2, second, utils::depositor()));
}
