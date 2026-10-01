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

    function test_withdrawContentHashPinned() public pure {
        assertEq(
            Hash.sha256ToField(abi.encodeWithSignature("withdraw(address,uint256,address)", RECIPIENT, AMOUNT, CALLER)),
            WITHDRAW
        );
    }
}
