// claim_private under TXE: the injected message commits compute_secret_hash(derive_claim_secret(salt, recipient)),
// only that recipient may submit the claim, and it must present the depositor the message names.

use super::utils;
use crate::TokenBridge;
use aztec::protocol::address::{AztecAddress, EthAddress};
use claim_secret_lib::derive_claim_secret;
use token::Token;

/// Injects an L1→L2 `mint_to_private` message from the default depositor with the recipient-committed secret hash.
pub unconstrained fn send_mint_to_private_message(
    env: aztec::test::helpers::test_environment::TestEnvironment,
    recipient: AztecAddress,
    amount: u128,
    salt: Field,
    bridge: AztecAddress,
) -> Field {
    utils::send_mint_to_private_message_from(env, recipient, amount, salt, utils::depositor(), bridge)
}

/// Happy path: the recipient claims its own deposit; the note is minted to it alone.
#[test]
unconstrained fn claim_private_by_the_recipient_mints_to_it() {
    let (mut env, _admin, _proxy, token, bridge) = utils::setup();
    let recipient = env.create_contract_account();
    let amount: u128 = 500_000;

    utils::fund_private(env, recipient, amount, 123456789, bridge);

    assert_eq(env.execute_utility(Token::at(token).balance_of_private(recipient)), amount);
}

/// A relayer holding the claim data can no longer submit a private claim: only the recipient may, which is what lets
/// the claim bind the recipient's account.
#[test(should_fail_with = "Only the recipient can claim privately")]
unconstrained fn claim_private_relayed_rejected() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let recipient = env.create_contract_account();
    let relayer = env.create_contract_account();
    let amount: u128 = 500_000;
    let salt = 123456789;

    let leaf = send_mint_to_private_message(env, recipient, amount, salt, bridge);
    env.call_private(
        relayer,
        TokenBridge::at(bridge).claim_private(recipient, amount, salt, leaf, utils::depositor(), true),
    );
}

/// A relayer redirecting to THEMSELVES derives a different secret: unconsumable. This is the
/// recipient-commitment property, proven live in-circuit.
#[test(should_fail_with = "No L1 to L2 message found")]
unconstrained fn claim_private_relayer_redirect_rejected() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let recipient = env.create_contract_account();
    let attacker = env.create_contract_account();
    let amount: u128 = 500_000;
    let salt = 42;

    // Message committed for `recipient`; attacker submits the claim naming THEMSELF.
    let leaf = send_mint_to_private_message(env, recipient, amount, salt, bridge);
    env.call_private(
        attacker,
        TokenBridge::at(bridge).claim_private(attacker, amount, salt, leaf, utils::depositor(), true),
    );
}

/// A wrong salt derives the wrong consumption secret even with the right recipient.
#[test(should_fail_with = "No L1 to L2 message found")]
unconstrained fn claim_private_wrong_salt_rejected() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let recipient = env.create_contract_account();
    let amount: u128 = 500_000;

    let leaf = send_mint_to_private_message(env, recipient, amount, 1, bridge);
    env.call_private(
        recipient,
        TokenBridge::at(bridge).claim_private(recipient, amount, 2, leaf, utils::depositor(), true),
    );
}

/// The message names the depositor, so a claim presenting another Ethereum address consumes nothing.
#[test(should_fail_with = "No L1 to L2 message found")]
unconstrained fn claim_private_wrong_depositor_rejected() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let recipient = env.create_contract_account();
    let amount: u128 = 500_000;
    let salt = 99;

    let leaf = send_mint_to_private_message(env, recipient, amount, salt, bridge);
    let other = EthAddress::from_field(0xBAD);
    env.call_private(recipient, TokenBridge::at(bridge).claim_private(recipient, amount, salt, leaf, other, true));
}

/// The pause gate reaches private execution through the enqueued public assert.
#[test(should_fail_with = "Bridge is paused")]
unconstrained fn claim_private_paused_rejected() {
    let (mut env, admin, _proxy, _token, bridge) = utils::setup();
    let recipient = env.create_contract_account();

    env.call_public(admin, TokenBridge::at(bridge).set_paused(true));
    utils::fund_private(env, recipient, 500_000, 7, bridge);
}

/// Private claims to zero are rejected before any note creation or message consumption.
#[test(should_fail_with = "Recipient cannot be zero")]
unconstrained fn claim_private_zero_recipient_rejected() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let relayer = env.create_contract_account();
    env.call_private(
        relayer,
        TokenBridge::at(bridge).claim_private(AztecAddress::zero(), 500_000, 7, 0, utils::depositor(), true),
    );
}

/// One message, one mint, on the private path too.
#[test(should_fail_with = "No non-nullified L1 to L2 message found")]
unconstrained fn claim_private_double_claim_rejected() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let recipient = env.create_contract_account();
    let amount: u128 = 500_000;
    let salt = 24680;

    let leaf = send_mint_to_private_message(env, recipient, amount, salt, bridge);
    env.call_private(
        recipient,
        TokenBridge::at(bridge).claim_private(recipient, amount, salt, leaf, utils::depositor(), true),
    );
    env.call_private(
        recipient,
        TokenBridge::at(bridge).claim_private(recipient, amount, salt, leaf, utils::depositor(), false),
    );
}

#[test(should_fail_with = "Amount must be greater than zero")]
unconstrained fn claim_private_zero_amount_rejected() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let recipient = env.create_contract_account();
    env.call_private(
        recipient,
        TokenBridge::at(bridge).claim_private(recipient, 0, 7, 0, utils::depositor(), true),
    );
}

/// A private deposit is unreachable through claim_public, even with its derived secret in hand: the public content
/// hash commits to (to, amount, depositor), the private one to (amount, depositor).
#[test(should_fail_with = "Tried to consume nonexistent L1-to-L2 message")]
unconstrained fn claim_public_cannot_redeem_a_private_deposit() {
    let (mut env, admin, _proxy, token, bridge) = utils::setup();
    let recipient = env.create_contract_account();
    let attacker = utils::merchant(&mut env, admin, token);
    let amount: u128 = 500_000;
    let salt = 77;

    let leaf = send_mint_to_private_message(env, recipient, amount, salt, bridge);
    let secret = derive_claim_secret(salt, recipient);
    env.call_public(
        attacker,
        TokenBridge::at(bridge).claim_public(attacker, amount, secret, leaf, utils::depositor()),
    );
}
