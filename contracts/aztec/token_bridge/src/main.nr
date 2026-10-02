mod config;
mod test;

// Moves one token between L1 and L2 through its TokenPortal's Inbox/Outbox messages, minting and burning via
// TokenMinterProxy, whose sole minter is this bridge. The owner can only pause claims and exits.

use aztec::macros::aztec;

#[aztec]
pub contract TokenBridge {
use crate::config::Config;

use aztec::{
macros::{functions::{external, initializer, only_self, view}, storage::storage},
protocol::address::{AztecAddress, EthAddress},
state_vars::{PublicImmutable, PublicMutable},
};

use portal_messages::{mint_to_private_content_hash, mint_to_public_content_hash, withdraw_content_hash};

use claim_secret_lib::derive_claim_secret;

use token_minter_proxy::TokenMinterProxy;

#[storage]
struct Storage<Context> {
owner: PublicMutable<AztecAddress, Context>,
pending_owner: PublicMutable<AztecAddress, Context>,
config: PublicImmutable<Config, Context>,
is_paused: PublicMutable<bool, Context>,
}

#[external("public")]
#[initializer]
fn constructor(token_minter_proxy: AztecAddress, portal: EthAddress) {
let sender = self.msg_sender();
self.storage.owner.write(sender);
self.storage.config.initialize(Config { token_minter_proxy, portal });
self.storage.is_paused.write(false);
}

#[external("public")]
fn transfer_ownership(new_owner: AztecAddress) {
assert(self.storage.owner.read() == self.msg_sender(), "Only owner");
assert(!new_owner.is_zero(), "New owner cannot be zero address");
self.storage.pending_owner.write(new_owner);
}

#[external("public")]
fn cancel_ownership_transfer() {
assert(self.storage.owner.read() == self.msg_sender(), "Only owner");
assert(!self.storage.pending_owner.read().is_zero(), "No pending owner");
self.storage.pending_owner.write(AztecAddress::zero());
}

#[external("public")]
fn claim_ownership() {
let sender = self.msg_sender();
assert(self.storage.pending_owner.read() == sender, "Only pending owner can claim");
self.storage.owner.write(sender);
self.storage.pending_owner.write(AztecAddress::zero());
}

#[external("public")]
fn set_paused(paused: bool) {
assert(self.storage.owner.read() == self.msg_sender(), "Only owner");
self.storage.is_paused.write(paused);
}

#[external("private")]
#[view]
fn get_config() -> Config {
self.storage.config.read()
}

#[external("public")]
#[view]
fn get_config_public() -> Config {
self.storage.config.read()
}

#[external("public")]
#[only_self]
fn _assert_not_paused() {
assert(self.storage.is_paused.read() == false, "Bridge is paused");
}

// Both claims hash the depositor the L1 message names, so a claim must present the Ethereum address the deposit came
// from; any other consumes nothing.
#[external("public")]
fn claim_public(to: AztecAddress, amount: u128, secret: Field, message_leaf_index: Field, depositor: EthAddress) {
assert(self.storage.is_paused.read() == false, "Bridge is paused");
assert(amount > 0, "Amount must be greater than zero");
let content_hash = mint_to_public_content_hash(to, amount, depositor);
let config = self.storage.config.read();
self.context.consume_l1_to_l2_message(content_hash, [secret], config.portal, message_leaf_index);
self.call(TokenMinterProxy::at(config.token_minter_proxy).mint_to_public(to, amount));
}

// The recipient is bound through the message's secret hash (claim_secret), not its content hash. INVARIANT: the only
// consumer of a `mint_to_private` message; an entrypoint taking a raw secret would make deposits bearer claims
// (scripts/check-sole-consumer.sh).
#[external("private")]
fn claim_private(
recipient: AztecAddress,
amount: u128,
claim_salt: Field,
message_leaf_index: Field,
depositor: EthAddress,
) {
self.enqueue_self._assert_not_paused();
assert(amount > 0, "Amount must be greater than zero");
assert(!recipient.is_zero(), "Recipient cannot be zero");
let config = self.storage.config.read();
let content_hash = mint_to_private_content_hash(amount, depositor);
let secret = derive_claim_secret(claim_salt, recipient);
self.context.consume_l1_to_l2_message(
content_hash,
[secret],
config.portal,
message_leaf_index,
);
self.call(TokenMinterProxy::at(config.token_minter_proxy).mint_to_private(recipient, amount));
}

#[external("public")]
fn exit_to_l1_public(recipient: EthAddress, amount: u128, caller_on_l1: EthAddress, authwit_nonce: Field) {
assert(self.storage.is_paused.read() == false, "Bridge is paused");
assert(amount > 0, "Amount must be greater than zero");
assert(!recipient.is_zero(), "Recipient cannot be zero");
let config = self.storage.config.read();
let content = withdraw_content_hash(recipient, amount, caller_on_l1);
self.context.message_portal(config.portal, content);
self.call(TokenMinterProxy::at(config.token_minter_proxy).burn_public(self.msg_sender(), amount, authwit_nonce));
}

#[external("private")]
fn exit_to_l1_private(recipient: EthAddress, amount: u128, caller_on_l1: EthAddress, authwit_nonce: Field) {
self.enqueue_self._assert_not_paused();
assert(amount > 0, "Amount must be greater than zero");
assert(!recipient.is_zero(), "Recipient cannot be zero");
let config = self.storage.config.read();
let content = withdraw_content_hash(recipient, amount, caller_on_l1);
self.context.message_portal(config.portal, content);
self.call(TokenMinterProxy::at(config.token_minter_proxy).burn_private(self.msg_sender(), amount, authwit_nonce));
}
}
