// Ownership lifecycle: two-step transfer semantics and pause-authority movement.

use super::utils;
use crate::TokenBridge;
use aztec::protocol::address::AztecAddress;

/// After a completed transfer, the NEW owner can pause and the OLD one cannot.
#[test]
unconstrained fn ownership_transfer_moves_pause_authority() {
    let (mut env, admin, _proxy, _token, bridge) = utils::setup();
    let new_owner = env.create_light_account();

    env.call_public(admin, TokenBridge::at(bridge).transfer_ownership(new_owner));
    env.call_public(new_owner, TokenBridge::at(bridge).claim_ownership());

    env.call_public(new_owner, TokenBridge::at(bridge).set_paused(true));
    assert(env.view_public(TokenBridge::at(bridge).get_config_public()).portal == utils::portal(), "config intact");
}

/// The transferred-FROM owner loses authority immediately after claim.
#[test(should_fail_with = "Only owner")]
unconstrained fn old_owner_cannot_pause_after_transfer() {
    let (mut env, admin, _proxy, _token, bridge) = utils::setup();
    let new_owner = env.create_light_account();

    env.call_public(admin, TokenBridge::at(bridge).transfer_ownership(new_owner));
    env.call_public(new_owner, TokenBridge::at(bridge).claim_ownership());
    env.call_public(admin, TokenBridge::at(bridge).set_paused(true));
}

#[test(should_fail_with = "Only owner")]
unconstrained fn non_owner_cannot_transfer_ownership() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let stranger = env.create_light_account();
    env.call_public(stranger, TokenBridge::at(bridge).transfer_ownership(stranger));
}

#[test(should_fail_with = "New owner cannot be zero address")]
unconstrained fn ownership_cannot_go_to_the_zero_address() {
    let (env, admin, _proxy, _token, bridge) = utils::setup();
    env.call_public(admin, TokenBridge::at(bridge).transfer_ownership(AztecAddress::zero()));
}

/// With a transfer pending, only the owner check stands between a stranger and the cancel.
#[test(should_fail_with = "Only owner")]
unconstrained fn non_owner_cannot_cancel_an_ownership_transfer() {
    let (mut env, admin, _proxy, _token, bridge) = utils::setup();
    let pending = env.create_light_account();
    let stranger = env.create_light_account();
    env.call_public(admin, TokenBridge::at(bridge).transfer_ownership(pending));
    env.call_public(stranger, TokenBridge::at(bridge).cancel_ownership_transfer());
}

#[test(should_fail_with = "No pending owner")]
unconstrained fn cancel_refuses_with_nothing_pending() {
    let (env, admin, _proxy, _token, bridge) = utils::setup();
    env.call_public(admin, TokenBridge::at(bridge).cancel_ownership_transfer());
}

/// A CANCELLED pending owner is rejected with the pending-owner assert.
#[test(should_fail_with = "Only pending owner can claim")]
unconstrained fn cancelled_pending_owner_cannot_claim() {
    let (mut env, admin, _proxy, _token, bridge) = utils::setup();
    let pending = env.create_light_account();

    env.call_public(admin, TokenBridge::at(bridge).transfer_ownership(pending));
    env.call_public(admin, TokenBridge::at(bridge).cancel_ownership_transfer());
    env.call_public(pending, TokenBridge::at(bridge).claim_ownership());
}
