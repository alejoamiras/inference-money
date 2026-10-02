// The contents of the messages TokenPortal.sol exchanges with the bridge: `Hash.sha256ToField(abi.encodeWithSignature(
// signature, args...))`, rebuilt here byte for byte. Mirrored in packages/bridge-core/src/content-hash.ts and pinned
// against Solidity and TypeScript by the keystone's vectors: a drift leaves every deposit's message unconsumable.
//
// Deposits name their depositor, the Ethereum address the funds came from, so a claim must present it. The withdraw
// message keeps the canonical format.
use aztec::protocol::{address::{AztecAddress, EthAddress}, hash::sha256_to_field, traits::ToField};

pub fn mint_to_public_content_hash(to: AztecAddress, amount: u128, depositor: EthAddress) -> Field {
    let selector = comptime { selector("mint_to_public(bytes32,uint256,address)") };
    sha256_to_field(encode::<3, 100>(selector, [to.to_field(), amount as Field, depositor.to_field()]))
}

pub fn mint_to_private_content_hash(amount: u128, depositor: EthAddress) -> Field {
    let selector = comptime { selector("mint_to_private(uint256,address)") };
    sha256_to_field(encode::<2, 68>(selector, [amount as Field, depositor.to_field()]))
}

// Solidity reads `recipient` and `caller_on_l1` as `address`, and an ABI-decoded EthAddress may hold any field, so a wider
// one would emit a message no withdraw could rebuild. The deposit encoders need none: a wider depositor matches no message.
pub fn withdraw_content_hash(recipient: EthAddress, amount: u128, caller_on_l1: EthAddress) -> Field {
    assert(fits_address(recipient) & fits_address(caller_on_l1), "A withdraw names only 20-byte Ethereum addresses");
    let selector = comptime { selector("withdraw(address,uint256,address)") };
    sha256_to_field(encode::<3, 100>(selector, [recipient.to_field(), amount as Field, caller_on_l1.to_field()]))
}

// EthAddress::validate's bound, with a refusal a caller can read.
fn fits_address(address: EthAddress) -> bool {
    address.to_field().lt(0x10000000000000000000000000000000000000000)
}

// The selector only makes the hash unique to its action; nothing on L1 calls it.
fn selector<let N: u32>(signature: str<N>) -> [u8; 4] {
    let digest = keccak256::keccak256(signature.as_bytes(), N);
    [digest[0], digest[1], digest[2], digest[3]]
}

// `abi.encodeWithSignature` for static arguments: the selector, then each argument as a 32-byte big-endian word.
fn encode<let N: u32, let M: u32>(selector: [u8; 4], words: [Field; N]) -> [u8; M] {
    std::static_assert(M == 4 + 32 * N, "an encoding is 4 bytes of selector and 32 per argument");
    let mut out = [0; M];
    for i in 0..4 {
        out[i] = selector[i];
    }
    for w in 0..N {
        let bytes: [u8; 32] = words[w].to_be_bytes();
        for i in 0..32 {
            out[4 + 32 * w + i] = bytes[i];
        }
    }
    out
}
