// claim_private under TXE: the recipient-committed secret derivation is exercised END-TO-END —
// the injected message commits compute_secret_hash(derive_claim_secret(salt, recipient)) and only
// a claim naming THAT recipient + salt can consume it, no matter who relays.

use super::utils;
use crate::TokenBridge;
use aztec::{
    protocol::address::AztecAddress,
    test::helpers::test_environment::TestEnvironment,
};
use claim_secret_lib::derive_claim_secret;
use token::Token;
use token_portal_content_hash_lib::get_mint_to_private_content_hash;

/// Injects an L1→L2 `mint_to_private` message with the recipient-committed secret hash.
pub unconstrained fn send_mint_to_private_message(
    env: TestEnvironment,
    recipient: AztecAddress,
    amount: u128,
    salt: Field,
    bridge: AztecAddress,
) -> Field {
    let content = get_mint_to_private_content_hash(amount);
    let consumption_secret = derive_claim_secret(salt, recipient);
    env.send_l1_to_l2_message_from_secret_hash(
        content,
        aztec::hash::compute_secret_hash([consumption_secret]),
        utils::portal(),
        bridge,
    )
}

/// Happy path via a RELAYER: anyone can submit the claim; only the named recipient's note is minted.
#[test]
unconstrained fn claim_private_via_relayer_mints_to_recipient() {
    let (mut env, _admin, _proxy, token, bridge) = utils::setup();
    // Full keys on both: reading a private balance needs them, and the relayer's is asserted too.
    let recipient = env.create_contract_account();
    let relayer = env.create_contract_account();
    let amount: u128 = 500_000;
    let salt = 123456789;

    let leaf = send_mint_to_private_message(env, recipient, amount, salt, bridge);
    env.call_private(relayer, TokenBridge::at(bridge).claim_private(recipient, amount, salt, leaf));

    assert_eq(env.execute_utility(Token::at(token).balance_of_private(recipient)), amount);
    assert_eq(env.execute_utility(Token::at(token).balance_of_private(relayer)), 0);
    assert_eq(env.view_public(Token::at(token).balance_of_public(relayer)), 0);
}

/// A relayer redirecting to THEMSELVES derives a different secret — unconsumable. This is the
/// recipient-commitment property, proven live in-circuit.
#[test(should_fail_with = "No L1 to L2 message found")]
unconstrained fn claim_private_relayer_redirect_rejected() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let recipient = env.create_contract_account();
    let attacker = env.create_light_account();
    let amount: u128 = 500_000;
    let salt = 42;

    // Message committed for `recipient`; attacker submits the claim naming THEMSELF.
    let leaf = send_mint_to_private_message(env, recipient, amount, salt, bridge);
    env.call_private(attacker, TokenBridge::at(bridge).claim_private(attacker, amount, salt, leaf));
}

/// A wrong salt derives the wrong consumption secret even with the right recipient.
#[test(should_fail_with = "No L1 to L2 message found")]
unconstrained fn claim_private_wrong_salt_rejected() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let recipient = env.create_contract_account();
    let amount: u128 = 500_000;

    let leaf = send_mint_to_private_message(env, recipient, amount, 1, bridge);
    env.call_private(recipient, TokenBridge::at(bridge).claim_private(recipient, amount, 2, leaf));
}

/// The pause gate reaches private execution through the enqueued public assert.
#[test(should_fail_with = "Bridge is paused")]
unconstrained fn claim_private_paused_rejected() {
    let (mut env, admin, _proxy, _token, bridge) = utils::setup();
    let recipient = env.create_contract_account();
    let amount: u128 = 500_000;
    let salt = 7;

    env.call_public(admin, TokenBridge::at(bridge).set_paused(true));
    let leaf = send_mint_to_private_message(env, recipient, amount, salt, bridge);
    env.call_private(recipient, TokenBridge::at(bridge).claim_private(recipient, amount, salt, leaf));
}

/// Private claims to zero are rejected before any note creation or message consumption.
#[test(should_fail_with = "Recipient cannot be zero")]
unconstrained fn claim_private_zero_recipient_rejected() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let relayer = env.create_light_account();
    env.call_private(relayer, TokenBridge::at(bridge).claim_private(AztecAddress::zero(), 500_000, 7, 0));
}

/// One message, one mint. The public path pinned this; the private path shares the same
/// message-nullifier mechanism but had no replay test, so a nullifier regression would have
/// been caught on only half the surface — and the private half is the one a relayer drives.
#[test(should_fail_with = "No non-nullified L1 to L2 message found")]
unconstrained fn claim_private_double_claim_rejected() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let recipient = env.create_contract_account();
    let amount: u128 = 500_000;
    let salt = 24680;

    let leaf = send_mint_to_private_message(env, recipient, amount, salt, bridge);
    env.call_private(recipient, TokenBridge::at(bridge).claim_private(recipient, amount, salt, leaf));
    env.call_private(recipient, TokenBridge::at(bridge).claim_private(recipient, amount, salt, leaf));
}

#[test(should_fail_with = "Amount must be greater than zero")]
unconstrained fn claim_private_zero_amount_rejected() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let recipient = env.create_contract_account();
    env.call_private(recipient, TokenBridge::at(bridge).claim_private(recipient, 0, 7, 0));
}
