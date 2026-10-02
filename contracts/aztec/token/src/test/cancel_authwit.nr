use crate::test::utils;
use crate::Token;
use aztec::authwit::auth::compute_inner_authwit_hash;
use aztec::hash::hash_args;
use aztec::protocol::traits::ToField;
use aztec::test::helpers::authwit as authwit_cheatcodes;
use generic_proxy::GenericProxy;

// Proves that once `owner` cancels a private authwit, a caller holding that authwit can no longer
// consume it: the cancellation pre-emits the authwit nullifier, so the later authwit-gated transfer
// fails when it tries to emit the same nullifier again.
#[test(should_fail_with = "duplicate nullifiers")]
unconstrained fn cancelled_authwit_cannot_be_consumed() {
    let (mut env, token_contract_address, owner, recipient, proxy) =
        utils::setup_and_mint_to_private_with_proxy();

    let transfer_amount = (1000 as u128);
    let transfer_call = Token::at(token_contract_address).transfer_private_to_private(
        owner,
        recipient,
        transfer_amount,
        1,
    );

    // owner grants the authwit to the proxy
    authwit_cheatcodes::add_private_authwit_from_call(env, owner, proxy, transfer_call);

    // owner cancels it, using the same inner hash the authwit machinery derives
    let inner_hash = compute_inner_authwit_hash([
        proxy.to_field(),
        transfer_call.selector.to_field(),
        hash_args(transfer_call.args),
    ]);
    env.call_private(owner, Token::at(token_contract_address).cancel_authwit(inner_hash));

    // proxy now attempts the transfer with the cancelled authwit — must fail
    env.call_private(
        owner,
        GenericProxy::at(proxy).forward_private_4(
            transfer_call.target_contract,
            transfer_call.selector,
            transfer_call.args,
        ),
    );
}

// Sanity: the SAME flow WITHOUT the cancel succeeds, so the failure above is attributable to the
// cancellation and not to some unrelated setup problem.
#[test]
unconstrained fn uncancelled_authwit_is_consumed() {
    let (mut env, token_contract_address, owner, recipient, proxy) =
        utils::setup_and_mint_to_private_with_proxy();

    let transfer_amount = (1000 as u128);
    let transfer_call = Token::at(token_contract_address).transfer_private_to_private(
        owner,
        recipient,
        transfer_amount,
        1,
    );

    authwit_cheatcodes::add_private_authwit_from_call(env, owner, proxy, transfer_call);

    env.call_private(
        owner,
        GenericProxy::at(proxy).forward_private_4(
            transfer_call.target_contract,
            transfer_call.selector,
            transfer_call.args,
        ),
    );

    utils::check_private_balance(env, token_contract_address, recipient, transfer_amount);
}

// Caller isolation: a foreign account cancelling with the owner's exact inner hash does NOT revoke
// the owner's authwit — the nullifier is bound to `msg_sender`, so the foreign cancel nullifies a
// different (attacker-bound) value and the owner's grant to the proxy still consumes successfully.
#[test]
unconstrained fn foreign_cancel_does_not_revoke_owner_authwit() {
    let (mut env, token_contract_address, owner, recipient, proxy) =
        utils::setup_and_mint_to_private_with_proxy();

    let transfer_amount = (1000 as u128);
    let transfer_call = Token::at(token_contract_address).transfer_private_to_private(
        owner,
        recipient,
        transfer_amount,
        1,
    );
    authwit_cheatcodes::add_private_authwit_from_call(env, owner, proxy, transfer_call);

    let inner_hash = compute_inner_authwit_hash([
        proxy.to_field(),
        transfer_call.selector.to_field(),
        hash_args(transfer_call.args),
    ]);
    // `recipient` (not the granter) attempts to cancel the owner's authwit
    env.call_private(recipient, Token::at(token_contract_address).cancel_authwit(inner_hash));

    // The owner's authwit is unaffected: the proxy transfer still succeeds
    env.call_private(
        owner,
        GenericProxy::at(proxy).forward_private_4(
            transfer_call.target_contract,
            transfer_call.selector,
            transfer_call.args,
        ),
    );
    utils::check_private_balance(env, token_contract_address, recipient, transfer_amount);
}
