use crate::test::utils;
use crate::Token;
use aztec::protocol::address::AztecAddress;

#[test]
unconstrained fn get_minter_returns_configured_minter() {
    // Deploy via constructor_with_minter and read the minter back through its view.
    let (env, token_contract_address, _, _, minter) = utils::setup_with_minter(false);

    let stored_minter = env.view_public(Token::at(token_contract_address).get_minter());
    assert(stored_minter == minter, "minter is not set correctly");

    // setup_with_minter wires auth_contract = zero (hook disabled by default).
    let stored_auth = env.view_public(Token::at(token_contract_address).get_auth_contract());
    assert(stored_auth == AztecAddress::zero(), "auth contract should be zero when disabled");
}

#[test]
unconstrained fn get_minter_zero_when_deployed_with_initial_supply() {
    // constructor_with_initial_supply initializes minter to zero (minting disabled);
    // get_minter must return zero rather than reverting on an uninitialized read.
    let (env, token_contract_address, _, _) = utils::setup_with_initial_supply(false, 1000);

    let stored_minter = env.view_public(Token::at(token_contract_address).get_minter());
    assert(
        stored_minter == AztecAddress::zero(),
        "minter should be zero for initial-supply tokens",
    );
}
