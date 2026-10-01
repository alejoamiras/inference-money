// Deploys and wires the production trio (proxy, standards Token, bridge) as the deployer does. Test messages are hashed
// with the same portal_messages lib the claims use, so they cannot drift from what the bridge expects.

use crate::TokenBridge;
use aztec::{
    protocol::address::{AztecAddress, EthAddress},
    test::helpers::test_environment::TestEnvironment,
};
use token::Token;
use token_minter_proxy::TokenMinterProxy;
use claim_secret_lib::derive_claim_secret;
use portal_messages::{mint_to_private_content_hash, mint_to_public_content_hash};

/// The L1 portal identity the bridge binds at construction; arbitrary but must match the
/// `sender` of every injected L1→L2 message.
pub global PORTAL: EthAddress = EthAddress::from_field(0x707741);

pub unconstrained fn portal() -> EthAddress {
    PORTAL
}

/// The Ethereum address every injected deposit message names; a claim must present the same one.
pub global DEPOSITOR: EthAddress = EthAddress::from_field(0xD0D0);

pub unconstrained fn depositor() -> EthAddress {
    DEPOSITOR
}

/// The full wired trio: (env, admin, proxy, token, bridge). Admin owns both proxy and bridge
/// (pause rights), as when one wallet deploys everything.
pub unconstrained fn setup() -> (TestEnvironment, AztecAddress, AztecAddress, AztecAddress, AztecAddress) {
    let mut env = TestEnvironment::new();
    let admin = env.create_light_account();

    // TokenMinterProxy: owner = admin (the initializer caller); single-shot set_token/set_bridge.
    let proxy_init = TokenMinterProxy::interface().constructor();
    let proxy = env
        .deploy("@token_minter_proxy/TokenMinterProxy")
        .with_public_initializer(admin, proxy_init);

    // Standards Token with the PROXY as its only minter (constructor_with_minter).
    let token_init = Token::interface().constructor_with_minter(
        "UsdcTestToken000000000000000000",
        "NTT0000000000000000000000000000",
        18,
        proxy,
        AztecAddress::zero(),
    );
    let token = env.deploy("@merchant_token/Token").with_public_initializer(admin, token_init);

    // The bridge binds proxy + portal; its owner (pause rights) is admin too.
    let bridge_init = TokenBridge::interface().constructor(proxy, PORTAL);
    let bridge = env.deploy("TokenBridge").with_public_initializer(admin, bridge_init);

    env.call_public(admin, TokenMinterProxy::at(proxy).set_token(token));
    env.call_public(admin, TokenMinterProxy::at(proxy).set_bridge(bridge));

    (env, admin, proxy, token, bridge)
}

/// Funds `recipient` with private notes through the legitimate claim path. Guard tests that
/// target the PRIVATE proxy/bridge entrypoints need a real private balance first: those calls
/// nullify notes during private execution, so an unfunded caller fails on the missing note or
/// authwit long before reaching the guard under test, and the test would pass for the wrong
/// reason. `recipient` must come from `create_contract_account()` — light accounts lack the
/// key set needed to spend private notes.
pub unconstrained fn fund_private(
    env: TestEnvironment,
    recipient: AztecAddress,
    amount: u128,
    salt: Field,
    bridge: AztecAddress,
) {
    let content = mint_to_private_content_hash(amount, DEPOSITOR);
    let secret_hash = aztec::hash::compute_secret_hash([derive_claim_secret(salt, recipient)]);
    let leaf = env.send_l1_to_l2_message_from_secret_hash(content, secret_hash, PORTAL, bridge);
    env.call_private(recipient, TokenBridge::at(bridge).claim_private(recipient, amount, salt, leaf, DEPOSITOR));
}

/// Injects an L1→L2 `mint_to_public` message exactly as TokenPortal would commit it, and
/// returns the leaf index to hand to `claim_public`.
pub unconstrained fn send_mint_to_public_message(
    env: TestEnvironment,
    to: AztecAddress,
    amount: u128,
    secret: Field,
    bridge: AztecAddress,
) -> Field {
    let content = mint_to_public_content_hash(to, amount, DEPOSITOR);
    env.send_l1_to_l2_message_from_secret_hash(
        content,
        aztec::hash::compute_secret_hash([secret]),
        PORTAL,
        bridge,
    )
}
