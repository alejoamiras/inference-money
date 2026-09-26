// #[only_self] entrypoints are reachable only through the contract's own enqueued calls. Each probe passes
// arguments under which the body itself would succeed, so only the only_self check can make it fail.

use super::utils;
use crate::TokenBridge;
use token_minter_proxy::TokenMinterProxy;

#[test(should_fail_with = "can only be called by the same contract")]
unconstrained fn assert_not_paused_rejects_a_stranger() {
    let (mut env, _admin, _proxy, _token, bridge) = utils::setup();
    let stranger = env.create_light_account();
    env.call_public(stranger, TokenBridge::at(bridge)._assert_not_paused());
}

#[test(should_fail_with = "can only be called by the same contract")]
unconstrained fn assert_not_paused_rejects_the_owner() {
    let (env, admin, _proxy, _token, bridge) = utils::setup();
    env.call_public(admin, TokenBridge::at(bridge)._assert_not_paused());
}

#[test(should_fail_with = "can only be called by the same contract")]
unconstrained fn assert_bridge_rejects_a_stranger() {
    let (mut env, _admin, proxy, _token, bridge) = utils::setup();
    let stranger = env.create_light_account();
    env.call_public(stranger, TokenMinterProxy::at(proxy).assert_bridge(bridge));
}

#[test(should_fail_with = "can only be called by the same contract")]
unconstrained fn assert_bridge_rejects_the_owner() {
    let (env, admin, proxy, _token, bridge) = utils::setup();
    env.call_public(admin, TokenMinterProxy::at(proxy).assert_bridge(bridge));
}
