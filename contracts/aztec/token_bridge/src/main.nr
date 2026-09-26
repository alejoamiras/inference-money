mod config;
mod test;

// Minimal token bridge that moves funds between L1 <> L2 via the canonical
// portal messaging (Inbox/Outbox). Attached to an L1 TokenPortal; mints/burns
// the L2 token through TokenMinterProxy (the bridge must be an authorized
// minter on the proxy). Stripped of the reference bridge's identity-attestation
// layer (clean-hands / passport / Schnorr): this bridge has no compliance
// gating, which is exactly what lets the private paths stay simple.

use aztec::macros::aztec;

#[aztec]
pub contract TokenBridge {
use crate::config::Config;

use aztec::{
macros::{functions::{external, initializer, only_self, view}, storage::storage},
protocol::address::{AztecAddress, EthAddress},
state_vars::{PublicImmutable, PublicMutable},
};

use token_portal_content_hash_lib::{
get_mint_to_private_content_hash, get_mint_to_public_content_hash, get_withdraw_content_hash,
};

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

// Consumes an L1->L2 message and mints the bridged amount publicly.
#[external("public")]
fn claim_public(to: AztecAddress, amount: u128, secret: Field, message_leaf_index: Field) {
assert(self.storage.is_paused.read() == false, "Bridge is paused");
assert(amount > 0, "Amount must be greater than zero");
let content_hash = get_mint_to_public_content_hash(to, amount);
let config = self.storage.config.read();
self.context.consume_l1_to_l2_message(content_hash, [secret], config.portal, message_leaf_index);
self.call(TokenMinterProxy::at(config.token_minter_proxy).mint_to_public(to, amount));
}

// Consumes an L1->L2 message and mints the bridged amount privately. The private content
// hash omits the recipient (amount only), but the consumption secret is DERIVED from the
// recipient in-circuit: `derive_claim_secret(claim_salt, recipient)`. So the recipient is
// committed via the message's secret_hash (fixed at deposit), not via the content hash — a
// claim naming a different recipient derives a different secret and can't consume the
// message. This lets a relayer submit the claim FOR the user without being able to redirect
// funds. INVARIANT: this is the ONLY path that consumes a `mint_to_private` message; adding
// any entrypoint that takes a raw secret would reintroduce the bearer property.
// Guarded by the sole-consumer static check (scripts/check-sole-consumer.sh).
#[external("private")]
fn claim_private(
recipient: AztecAddress,
amount: u128,
claim_salt: Field,
message_leaf_index: Field,
) {
self.enqueue_self._assert_not_paused();
assert(amount > 0, "Amount must be greater than zero");
assert(!recipient.is_zero(), "Recipient cannot be zero");
let config = self.storage.config.read();
let content_hash = get_mint_to_private_content_hash(amount);
let secret = derive_claim_secret(claim_salt, recipient);
self.context.consume_l1_to_l2_message(
content_hash,
[secret],
config.portal,
message_leaf_index,
);
self.call(TokenMinterProxy::at(config.token_minter_proxy).mint_to_private(recipient, amount));
}

// Burns publicly and creates an L2->L1 withdraw message.
#[external("public")]
fn exit_to_l1_public(recipient: EthAddress, amount: u128, caller_on_l1: EthAddress, authwit_nonce: Field) {
assert(self.storage.is_paused.read() == false, "Bridge is paused");
assert(amount > 0, "Amount must be greater than zero");
assert(!recipient.is_zero(), "Recipient cannot be zero");
let config = self.storage.config.read();
let content = get_withdraw_content_hash(recipient, amount, caller_on_l1);
self.context.message_portal(config.portal, content);
self.call(TokenMinterProxy::at(config.token_minter_proxy).burn_public(self.msg_sender(), amount, authwit_nonce));
}

// Burns privately and creates an L2->L1 withdraw message. No attestation gate.
#[external("private")]
fn exit_to_l1_private(recipient: EthAddress, amount: u128, caller_on_l1: EthAddress, authwit_nonce: Field) {
self.enqueue_self._assert_not_paused();
assert(amount > 0, "Amount must be greater than zero");
assert(!recipient.is_zero(), "Recipient cannot be zero");
let config = self.storage.config.read();
let content = get_withdraw_content_hash(recipient, amount, caller_on_l1);
self.context.message_portal(config.portal, content);
self.call(TokenMinterProxy::at(config.token_minter_proxy).burn_private(self.msg_sender(), amount, authwit_nonce));
}
}
