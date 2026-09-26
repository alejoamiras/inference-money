use aztec::macros::aztec;

// Immutable single-minter. The proxy authorizes EXACTLY ONE minter (the bridge), fixed
// once at bootstrap via the owner-gated, single-shot `set_bridge` (a `PublicImmutable` can only be
// initialized once). There is no `set_minter` and no owner mint power, so after `set_token` +
// `set_bridge` the owner has zero standing authority: a compromised owner key can neither mint nor
// add a minter. Mint/burn assert the caller is the bridge.
#[aztec]
pub contract TokenMinterProxy {
    use aztec::{
        macros::{functions::{external, initializer, only_self, view}, storage::storage},
        protocol::address::AztecAddress,
        state_vars::PublicImmutable,
    };
    use token::Token;

    #[storage]
    struct Storage<Context> {
        owner: PublicImmutable<AztecAddress, Context>,
        token: PublicImmutable<AztecAddress, Context>,
        bridge: PublicImmutable<AztecAddress, Context>,
    }

    #[external("public")]
    #[initializer]
    fn constructor() {
        self.storage.owner.initialize(self.msg_sender());
    }

    #[external("public")]
    fn set_token(token_address: AztecAddress) {
        let sender = self.msg_sender();
        assert(self.storage.owner.read().eq(sender), "not owner");
        self.storage.token.initialize(token_address);
    }

    // One-time, owner-gated. `PublicImmutable.initialize` reverts on a second call, so the sole
    // minter is locked to the bridge at bootstrap and can never be changed or added to.
    #[external("public")]
    fn set_bridge(bridge_address: AztecAddress) {
        let sender = self.msg_sender();
        assert(self.storage.owner.read().eq(sender), "not owner");
        self.storage.bridge.initialize(bridge_address);
    }

    #[external("public")]
    #[view]
    fn get_owner() -> AztecAddress {
        self.storage.owner.read()
    }

    #[external("public")]
    #[view]
    fn get_token() -> AztecAddress {
        self.storage.token.read()
    }

    #[external("public")]
    #[view]
    fn get_bridge() -> AztecAddress {
        self.storage.bridge.read()
    }

    #[external("public")]
    #[only_self]
    fn assert_bridge(caller: AztecAddress) {
        assert(self.storage.bridge.read().eq(caller), "not the bridge");
    }

    #[external("public")]
    fn mint_to_public(recipient: AztecAddress, amount: u128) {
        assert(self.storage.bridge.read().eq(self.msg_sender()), "not the bridge");
        let token = Token::at(self.storage.token.read());
        self.call(token.mint_to_public(recipient, amount));
    }

    #[external("public")]
    fn burn_public(user_address: AztecAddress, amount: u128, authwit_nonce: Field) {
        assert(self.storage.bridge.read().eq(self.msg_sender()), "not the bridge");
        let token = Token::at(self.storage.token.read());
        self.call(token.burn_public(user_address, amount, authwit_nonce));
    }

    #[external("private")]
    fn mint_to_private(recipient: AztecAddress, amount: u128) {
        self.enqueue_self.assert_bridge(self.msg_sender());
        let token = Token::at(self.storage.token.read());
        self.call(token.mint_to_private(recipient, amount));
    }

    #[external("private")]
    fn burn_private(user_address: AztecAddress, amount: u128, authwit_nonce: Field) {
        self.enqueue_self.assert_bridge(self.msg_sender());
        let token = Token::at(self.storage.token.read());
        self.call(token.burn_private(user_address, amount, authwit_nonce));
    }
}
