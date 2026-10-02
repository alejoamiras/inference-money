// claim_public under TXE: a public deposit funds the merchant its message commits to, whoever relays it; a user
// recipient is refused, and every message-level mismatch (recipient, amount, secret, depositor, replay) consumes nothing.

use super::utils;
use crate::TokenBridge;
use aztec::protocol::address::EthAddress;
use token::Token;

/// Happy path: an L1 deposit message consumed publicly mints to the merchant `to` and nothing else.
#[test]
unconstrained fn claim_public_mints_to_recipient() {
    let (mut env, admin, _proxy, token, bridge) = utils::setup();
    let to = utils::merchant(&mut env, admin, token);
    let amount: u128 = 1_000_000;

    utils::fund_public(env, to, amount, 42, bridge);

    assert_eq(env.view_public(Token::at(token).balance_of_public(to)), amount);
}

/// Anyone may submit a public claim; the tokens land with the committed merchant, never the caller.
#[test]
unconstrained fn claim_public_by_relayer_credits_the_recipient() {
    let (mut env, admin, _proxy, token, bridge) = utils::setup();
    let to = utils::merchant(&mut env, admin, token);
    let relayer = env.create_light_account();
    let amount: u128 = 1_000_000;

    let leaf = utils::send_mint_to_public_message(env, to, amount, 42, bridge);
    env.call_public(relayer, TokenBridge::at(bridge).claim_public(to, amount, 42, leaf, utils::depositor()));

    assert_eq(env.view_public(Token::at(token).balance_of_public(to)), amount);
    assert_eq(env.view_public(Token::at(token).balance_of_public(relayer)), 0);
}

/// Public deposits fund merchants only: a user's is refused before its message is touched, so it stays returnable.
#[test(should_fail_with = "Public claims are for merchants only")]
unconstrained fn claim_public_to_a_user_rejected() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let user = env.create_light_account();

    let leaf = utils::send_mint_to_public_message(env, user, 1_000_000, 42, bridge);
    env.call_public(user, TokenBridge::at(bridge).claim_public(user, 1_000_000, 42, leaf, utils::depositor()));
}

/// A claim naming a DIFFERENT merchant derives a different content hash: unconsumable.
#[test(should_fail_with = "Tried to consume nonexistent L1-to-L2 message")]
unconstrained fn claim_public_wrong_recipient_rejected() {
    let (mut env, admin, _proxy, token, bridge) = utils::setup();
    let to = utils::merchant(&mut env, admin, token);
    let other = utils::merchant(&mut env, admin, token);

    let leaf = utils::send_mint_to_public_message(env, to, 1_000_000, 42, bridge);
    env.call_public(to, TokenBridge::at(bridge).claim_public(other, 1_000_000, 42, leaf, utils::depositor()));
}

/// The amount is inside the content hash: claiming more (or less) than was deposited is unconsumable.
#[test(should_fail_with = "Tried to consume nonexistent L1-to-L2 message")]
unconstrained fn claim_public_wrong_amount_rejected() {
    let (mut env, admin, _proxy, token, bridge) = utils::setup();
    let to = utils::merchant(&mut env, admin, token);

    let leaf = utils::send_mint_to_public_message(env, to, 1_000_000, 42, bridge);
    env.call_public(to, TokenBridge::at(bridge).claim_public(to, 1_000_001, 42, leaf, utils::depositor()));
}

/// The message names the depositor, so a claim presenting another Ethereum address consumes nothing.
#[test(should_fail_with = "Tried to consume nonexistent L1-to-L2 message")]
unconstrained fn claim_public_wrong_depositor_rejected() {
    let (mut env, admin, _proxy, token, bridge) = utils::setup();
    let to = utils::merchant(&mut env, admin, token);

    let leaf = utils::send_mint_to_public_message(env, to, 1_000_000, 42, bridge);
    let other = EthAddress::from_field(0xBAD);
    env.call_public(to, TokenBridge::at(bridge).claim_public(to, 1_000_000, 42, leaf, other));
}

/// A wrong consumption secret fails the message-membership check.
#[test(should_fail_with = "Tried to consume nonexistent L1-to-L2 message")]
unconstrained fn claim_public_wrong_secret_rejected() {
    let (mut env, admin, _proxy, token, bridge) = utils::setup();
    let to = utils::merchant(&mut env, admin, token);

    let leaf = utils::send_mint_to_public_message(env, to, 1_000_000, 42, bridge);
    env.call_public(to, TokenBridge::at(bridge).claim_public(to, 1_000_000, 43, leaf, utils::depositor()));
}

/// Nullifier replay: the same leaf cannot fund two claims.
#[test(should_fail_with = "L1-to-L2 message is already nullified")]
unconstrained fn claim_public_double_claim_rejected() {
    let (mut env, admin, _proxy, token, bridge) = utils::setup();
    let to = utils::merchant(&mut env, admin, token);

    let leaf = utils::send_mint_to_public_message(env, to, 1_000_000, 7, bridge);
    env.call_public(to, TokenBridge::at(bridge).claim_public(to, 1_000_000, 7, leaf, utils::depositor()));
    env.call_public(to, TokenBridge::at(bridge).claim_public(to, 1_000_000, 7, leaf, utils::depositor()));
}

/// The owner's pause gate blocks public claims.
#[test(should_fail_with = "Bridge is paused")]
unconstrained fn claim_public_paused_rejected() {
    let (mut env, admin, _proxy, token, bridge) = utils::setup();
    let to = utils::merchant(&mut env, admin, token);

    env.call_public(admin, TokenBridge::at(bridge).set_paused(true));
    utils::fund_public(env, to, 1_000_000, 42, bridge);
}

/// Zero-amount claims are rejected before any messaging.
#[test(should_fail_with = "Amount must be greater than zero")]
unconstrained fn claim_public_zero_amount_rejected() {
    let (mut env, admin, _proxy, token, bridge) = utils::setup();
    let to = utils::merchant(&mut env, admin, token);
    env.call_public(to, TokenBridge::at(bridge).claim_public(to, 0, 42, 0, utils::depositor()));
}

/// Pause is a toggle, not a one-way switch: unpause restores normal claims.
#[test]
unconstrained fn claim_public_unpause_restores_claims() {
    let (mut env, admin, _proxy, token, bridge) = utils::setup();
    let to = utils::merchant(&mut env, admin, token);

    env.call_public(admin, TokenBridge::at(bridge).set_paused(true));
    env.call_public(admin, TokenBridge::at(bridge).set_paused(false));

    utils::fund_public(env, to, 250_000, 9, bridge);
    assert_eq(env.view_public(Token::at(token).balance_of_public(to)), 250_000);
}
