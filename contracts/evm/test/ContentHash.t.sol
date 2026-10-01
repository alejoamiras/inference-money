// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

import {Test} from "forge-std/Test.sol";
import {Hash} from "@aztec/core/libraries/crypto/Hash.sol";

/// KEYSTONE: pins the L1 content hashes the portal commits for the L2 `token_bridge` to consume. The same literals
/// are asserted by the Noir keystone crate and by bridge-core, for the same inputs. That equality is the one
/// cross-chain boundary no single toolchain can test: if a selector or argument order drifts, every deposit's
/// message becomes unconsumable and the funds strand.
contract ContentHashTest is Test {
    bytes32 constant TO = bytes32(uint256(0x1234));
    uint256 constant AMOUNT = 1_000_000;
    address constant DEPOSITOR = address(uint160(0xD0D0));
    address constant RECIPIENT = address(uint160(0xBEEF));
    address constant CALLER = address(0);

    bytes32 constant MINT_TO_PUBLIC = 0x00dbc90158731bb184636b606f4a34496eb320d1215f259c4c53afeea7629e23;
    bytes32 constant MINT_TO_PRIVATE = 0x006bfc126e408142a4cc801b6780b5c8c7ad7bfc7cb23d1a2cbb731a958c2a07;
    bytes32 constant WITHDRAW = 0x00ac390e12f1097130e1a7c2e5eea30780cd11d12002b8de22d608cf10a60775;

    // The top bit of every word set: an encoder that truncates an address or amount still matches the low vectors.
    address constant HIGH_DEPOSITOR = address(uint160((1 << 159) | 1));
    bytes32 constant MINT_TO_PUBLIC_HIGH = 0x00c92584ad559f46de9851f17d4c3d591df8dd99278eaa8dd7d568af0b076685;
    bytes32 constant MINT_TO_PRIVATE_HIGH = 0x0027e4159023e23580ae653c0c0cc3ea532ec740f7f9cee719433a8674acd365;

    function test_mintToPublicContentHashPinned() public pure {
        assertEq(
            Hash.sha256ToField(
                abi.encodeWithSignature("mint_to_public(bytes32,uint256,address)", TO, AMOUNT, DEPOSITOR)
            ),
            MINT_TO_PUBLIC
        );
    }

    function test_mintToPrivateContentHashPinned() public pure {
        assertEq(
            Hash.sha256ToField(abi.encodeWithSignature("mint_to_private(uint256,address)", AMOUNT, DEPOSITOR)),
            MINT_TO_PRIVATE
        );
    }

    function test_mintToPublicContentHashPinnedAtHighBits() public pure {
        assertEq(
            Hash.sha256ToField(
                abi.encodeWithSignature(
                    "mint_to_public(bytes32,uint256,address)", TO, uint256(1) << 127, HIGH_DEPOSITOR
                )
            ),
            MINT_TO_PUBLIC_HIGH
        );
    }

    function test_mintToPrivateContentHashPinnedAtHighBits() public pure {
        assertEq(
            Hash.sha256ToField(
                abi.encodeWithSignature("mint_to_private(uint256,address)", uint256(type(uint128).max), HIGH_DEPOSITOR)
            ),
            MINT_TO_PRIVATE_HIGH
        );
    }

    function test_withdrawContentHashPinned() public pure {
        assertEq(
            Hash.sha256ToField(abi.encodeWithSignature("withdraw(address,uint256,address)", RECIPIENT, AMOUNT, CALLER)),
            WITHDRAW
        );
    }
}
