// claim_public / claim_private behavior under TXE: happy paths, and every failure mode the
// circuit must enforce (wrong secret, wrong recipient, paused bridge, nullifier replay).

use super::utils;
use crate::TokenBridge;
use aztec::protocol::address::EthAddress;
use token::Token;

/// Happy path: an L1 deposit message consumed publicly mints to `to` and nothing else.
#[test]
unconstrained fn claim_public_mints_to_recipient() {
    let (mut env, _admin, _proxy, token, bridge) = utils::setup();
    let to = env.create_light_account();
    let amount: u128 = 1_000_000;
    let secret = 42;

    let leaf = utils::send_mint_to_public_message(env, to, amount, secret, bridge);
    env.call_public(to, TokenBridge::at(bridge).claim_public(to, amount, secret, leaf, utils::depositor()));

    assert_eq(env.view_public(Token::at(token).balance_of_public(to)), amount);
}

/// A claim naming a DIFFERENT recipient derives a different content hash — unconsumable.
#[test(should_fail_with = "Tried to consume nonexistent L1-to-L2 message")]
unconstrained fn claim_public_wrong_recipient_rejected() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let to = env.create_light_account();
    let other = env.create_light_account();
    let amount: u128 = 1_000_000;
    let secret = 42;

    // Message bound to `to`; claim attempts to redirect to `other`.
    let leaf = utils::send_mint_to_public_message(env, to, amount, secret, bridge);
    env.call_public(to, TokenBridge::at(bridge).claim_public(other, amount, secret, leaf, utils::depositor()));
}

/// The message names the depositor, so a claim presenting another Ethereum address consumes nothing.
#[test(should_fail_with = "Tried to consume nonexistent L1-to-L2 message")]
unconstrained fn claim_public_wrong_depositor_rejected() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let to = env.create_light_account();
    let amount: u128 = 1_000_000;
    let secret = 42;

    let leaf = utils::send_mint_to_public_message(env, to, amount, secret, bridge);
    let other = EthAddress::from_field(0xBAD);
    env.call_public(to, TokenBridge::at(bridge).claim_public(to, amount, secret, leaf, other));
}

/// A wrong consumption secret fails the message-membership check.
#[test(should_fail_with = "Tried to consume nonexistent L1-to-L2 message")]
unconstrained fn claim_public_wrong_secret_rejected() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let to = env.create_light_account();
    let amount: u128 = 1_000_000;

    let leaf = utils::send_mint_to_public_message(env, to, amount, 42, bridge);
    env.call_public(to, TokenBridge::at(bridge).claim_public(to, amount, 43, leaf, utils::depositor()));
}

/// Nullifier replay: the same leaf cannot fund two claims.
#[test(should_fail_with = "L1-to-L2 message is already nullified")]
unconstrained fn claim_public_double_claim_rejected() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let to = env.create_light_account();
    let amount: u128 = 1_000_000;
    let secret = 7;

    let leaf = utils::send_mint_to_public_message(env, to, amount, secret, bridge);
    env.call_public(to, TokenBridge::at(bridge).claim_public(to, amount, secret, leaf, utils::depositor()));
    env.call_public(to, TokenBridge::at(bridge).claim_public(to, amount, secret, leaf, utils::depositor()));
}

/// The owner's pause gate blocks public claims.
#[test(should_fail_with = "Bridge is paused")]
unconstrained fn claim_public_paused_rejected() {
    let (mut env, admin, _proxy, _token, bridge) = utils::setup();
    let to = env.create_light_account();
    let amount: u128 = 1_000_000;
    let secret = 42;

    env.call_public(admin, TokenBridge::at(bridge).set_paused(true));
    let leaf = utils::send_mint_to_public_message(env, to, amount, secret, bridge);
    env.call_public(to, TokenBridge::at(bridge).claim_public(to, amount, secret, leaf, utils::depositor()));
}

/// Zero-amount claims are rejected before any messaging.
#[test(should_fail_with = "Amount must be greater than zero")]
unconstrained fn claim_public_zero_amount_rejected() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let to = env.create_light_account();
    env.call_public(to, TokenBridge::at(bridge).claim_public(to, 0, 42, 0, utils::depositor()));
}

/// Pause is a toggle, not a one-way switch: unpause restores normal claims.
#[test]
unconstrained fn claim_public_unpause_restores_claims() {
    let (mut env, admin, _proxy, token, bridge) = utils::setup();
    let to = env.create_light_account();
    let amount: u128 = 250_000;
    let secret = 9;

    env.call_public(admin, TokenBridge::at(bridge).set_paused(true));
    env.call_public(admin, TokenBridge::at(bridge).set_paused(false));

    let leaf = utils::send_mint_to_public_message(env, to, amount, secret, bridge);
    env.call_public(to, TokenBridge::at(bridge).claim_public(to, amount, secret, leaf, utils::depositor()));
    assert_eq(env.view_public(Token::at(token).balance_of_public(to)), amount);
}

/// The amount is inside the content hash: claiming more (or less) than was deposited is unconsumable.
#[test(should_fail_with = "Tried to consume nonexistent L1-to-L2 message")]
unconstrained fn claim_public_wrong_amount_rejected() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let to = env.create_light_account();

    let leaf = utils::send_mint_to_public_message(env, to, 1_000_000, 42, bridge);
    env.call_public(to, TokenBridge::at(bridge).claim_public(to, 1_000_001, 42, leaf, utils::depositor()));
}

/// Anyone may submit a public claim; the tokens land with the committed recipient, never the caller.
#[test]
unconstrained fn claim_public_by_relayer_credits_the_recipient() {
    let (mut env, _admin, _proxy, token, bridge) = utils::setup();
    let to = env.create_light_account();
    let relayer = env.create_light_account();
    let amount: u128 = 1_000_000;

    let leaf = utils::send_mint_to_public_message(env, to, amount, 42, bridge);
    env.call_public(relayer, TokenBridge::at(bridge).claim_public(to, amount, 42, leaf, utils::depositor()));

    assert_eq(env.view_public(Token::at(token).balance_of_public(to)), amount);
    assert_eq(env.view_public(Token::at(token).balance_of_public(relayer)), 0);
}
