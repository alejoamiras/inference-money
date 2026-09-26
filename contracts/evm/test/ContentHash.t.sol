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
    address constant RECIPIENT = address(uint160(0xBEEF));
    address constant CALLER = address(0);

    bytes32 constant MINT_TO_PUBLIC = 0x00fb464b41c6a08b28bfe9b8a11c1c4dcd2d4c9c66e703988cb76eb00e140dcc;
    bytes32 constant MINT_TO_PRIVATE = 0x00009b1ee836fa551bb50bb45e2c8e698cc680c6e68e429370625119a2c63954;
    bytes32 constant WITHDRAW = 0x00ac390e12f1097130e1a7c2e5eea30780cd11d12002b8de22d608cf10a60775;

    function test_mintToPublicContentHashPinned() public pure {
        assertEq(
            Hash.sha256ToField(abi.encodeWithSignature("mint_to_public(bytes32,uint256)", TO, AMOUNT)), MINT_TO_PUBLIC
        );
    }

    function test_mintToPrivateContentHashPinned() public pure {
        assertEq(Hash.sha256ToField(abi.encodeWithSignature("mint_to_private(uint256)", AMOUNT)), MINT_TO_PRIVATE);
    }

    function test_withdrawContentHashPinned() public pure {
        assertEq(
            Hash.sha256ToField(abi.encodeWithSignature("withdraw(address,uint256,address)", RECIPIENT, AMOUNT, CALLER)),
            WITHDRAW
        );
    }
}
