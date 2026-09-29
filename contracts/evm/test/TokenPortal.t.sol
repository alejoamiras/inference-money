// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@oz/token/ERC20/IERC20.sol";
import {ReentrancyGuardTransient} from "@oz/utils/ReentrancyGuardTransient.sol";
import {DataStructures} from "@aztec/core/libraries/DataStructures.sol";
import {Hash} from "@aztec/core/libraries/crypto/Hash.sol";
import {Epoch} from "@aztec/core/libraries/TimeLib.sol";

import {TokenPortal} from "../src/TokenPortal.sol";
import {CapturingInbox, CapturingOutbox, FakeRegistry, FakeRollup} from "./mocks/AztecFakes.sol";
import {FeeOnTransferERC20, HookERC20, PlainERC20, SenderSurchargeERC20} from "./mocks/TestTokens.sol";

/// Direct calls into the portal, bypassing the router: the canonical hashes and the guards must hold for anyone who
/// calls it, not only for the router's callers.
contract TokenPortalTest is Test {
    bytes32 internal constant BRIDGE = bytes32(uint256(0x4B));
    bytes32 internal constant TO = bytes32(uint256(0x1234));
    bytes32 internal constant SECRET_HASH = bytes32(uint256(0x5EC));

    address internal alice = makeAddr("alice");
    CapturingInbox internal inbox;
    CapturingOutbox internal outbox;
    FakeRegistry internal registry;

    function setUp() public {
        inbox = new CapturingInbox();
        outbox = new CapturingOutbox();
        registry = new FakeRegistry(address(new FakeRollup(address(inbox), address(outbox))));
    }

    function _portal(IERC20 token) internal returns (TokenPortal portal) {
        portal = new TokenPortal();
        portal.initialize(address(registry), address(token), BRIDGE);
    }

    /// A portal over a plain token, with `amount` minted to alice and approved.
    function _funded(uint256 amount) internal returns (TokenPortal portal, PlainERC20 token) {
        token = new PlainERC20("Tok", "TOK");
        portal = _portal(token);
        token.mint(alice, amount);
        vm.prank(alice);
        token.approve(address(portal), amount);
    }

    function test_depositPublic_commitsCanonicalHash() public {
        (TokenPortal portal, PlainERC20 token) = _funded(1_000);
        bytes32 content = Hash.sha256ToField(abi.encodeWithSignature("mint_to_public(bytes32,uint256)", TO, 1_000));
        vm.expectEmit(address(portal));
        emit TokenPortal.DepositToAztecPublic(TO, 1_000, SECRET_HASH, keccak256(abi.encode(content, SECRET_HASH)), 0);
        vm.prank(alice);
        (bytes32 key, uint256 index) = portal.depositToAztecPublic(TO, 1_000, SECRET_HASH);

        assertEq(key, keccak256(abi.encode(content, SECRET_HASH)), "key is the inbox's");
        assertEq(index, 0, "index is the inbox's");
        assertEq(inbox.lastContentHash(), content, "content hash");
        assertEq(inbox.lastSecretHash(), SECRET_HASH, "secret hash");
        assertEq(inbox.lastSender(), address(portal), "sender");
        assertEq(inbox.lastBridge(), BRIDGE, "recipient bridge");
        assertEq(inbox.lastVersion(), FakeRollup(registry.rollup()).VERSION(), "rollup version");
        assertEq(token.balanceOf(address(portal)), 1_000, "reserve");
        assertEq(token.balanceOf(alice), 0, "alice paid");
    }

    function test_depositPrivate_commitsCanonicalHash() public {
        (TokenPortal portal,) = _funded(7);
        vm.prank(alice);
        portal.depositToAztecPrivate(7, SECRET_HASH);
        assertEq(inbox.lastContentHash(), Hash.sha256ToField(abi.encodeWithSignature("mint_to_private(uint256)", 7)));
        assertEq(inbox.lastSecretHash(), SECRET_HASH);
    }

    function test_withdraw_consumesAndDebitsExactly() public {
        (TokenPortal portal, PlainERC20 token) = _funded(500);
        vm.prank(alice);
        portal.depositToAztecPublic(TO, 500, SECRET_HASH);

        portal.withdraw(alice, 200, true, Epoch.wrap(3), 9, 5, new bytes32[](0));

        DataStructures.L2ToL1Msg memory m = outbox.lastMsg();
        assertEq(m.sender.actor, BRIDGE);
        assertEq(m.sender.version, FakeRollup(registry.rollup()).VERSION());
        assertEq(m.recipient.actor, address(portal));
        assertEq(m.recipient.chainId, block.chainid);
        assertEq(
            m.content,
            Hash.sha256ToField(abi.encodeWithSignature("withdraw(address,uint256,address)", alice, 200, address(this)))
        );
        assertEq(token.balanceOf(alice), 200);
        assertEq(token.balanceOf(address(portal)), 300);
    }

    /// u128 is the L2 amount type; one past it could never be claimed, and exactly the max still deposits.
    function test_deposit_capsAtU128() public {
        uint256 max = type(uint128).max;
        (TokenPortal portal,) = _funded(max);
        vm.startPrank(alice);
        vm.expectRevert(TokenPortal.AmountExceedsL2Max.selector);
        portal.depositToAztecPublic(TO, max + 1, SECRET_HASH);
        vm.expectRevert(TokenPortal.AmountExceedsL2Max.selector);
        portal.depositToAztecPrivate(max + 1, SECRET_HASH);
        portal.depositToAztecPrivate(max, SECRET_HASH);
        vm.stopPrank();
        assertEq(inbox.sent(), 1, "only the in-range deposit sent a message");
    }

    /// A token that delivers less than `amount` would mint more on L2 than the portal holds.
    function test_deposit_rejectsFeeOnTransfer() public {
        FeeOnTransferERC20 tax = new FeeOnTransferERC20(100);
        TokenPortal portal = _portal(tax);
        tax.mint(alice, 1_000);
        vm.startPrank(alice);
        tax.approve(address(portal), 1_000);
        vm.expectRevert(TokenPortal.InexactTransfer.selector);
        portal.depositToAztecPublic(TO, 1_000, SECRET_HASH);
        vm.expectRevert(TokenPortal.InexactTransfer.selector);
        portal.depositToAztecPrivate(1_000, SECRET_HASH);
        vm.stopPrank();
        assertEq(inbox.sent(), 0);
    }

    /// The mirror of the deposit check: a token that debits the reserve by more than the message authorized would
    /// bleed every other holder's backing, one withdrawal at a time.
    function test_withdraw_rejectsOverDebit() public {
        SenderSurchargeERC20 sur = new SenderSurchargeERC20(100);
        TokenPortal portal = _portal(sur);
        sur.mint(alice, 1_010);
        vm.startPrank(alice);
        sur.approve(address(portal), 1_000);
        portal.depositToAztecPublic(TO, 1_000, SECRET_HASH);
        vm.stopPrank();
        assertEq(sur.balanceOf(address(portal)), 1_000, "the deposit itself is exact");

        vm.expectRevert(TokenPortal.InexactTransfer.selector);
        portal.withdraw(alice, 500, false, Epoch.wrap(3), 9, 5, new bytes32[](0));
    }

    /// A payout to the portal itself never debits it, so such an exit can never be withdrawn. bridge-core refuses
    /// the portal as an exit recipient before burning on L2; this pins the L1 half of that rule.
    function test_withdraw_toThePortalItselfReverts() public {
        (TokenPortal portal,) = _funded(100);
        vm.prank(alice);
        portal.depositToAztecPrivate(100, SECRET_HASH);
        vm.expectRevert(TokenPortal.InexactTransfer.selector);
        portal.withdraw(address(portal), 100, false, Epoch.wrap(3), 9, 5, new bytes32[](0));
    }

    function test_deposit_reentryFromTokenHookReverts() public {
        HookERC20 hook = new HookERC20();
        TokenPortal portal = _portal(hook);
        hook.mint(alice, 100);
        vm.prank(alice);
        hook.approve(address(portal), 100);
        hook.arm(address(portal), address(portal), abi.encodeCall(TokenPortal.depositToAztecPrivate, (1, SECRET_HASH)));

        vm.prank(alice);
        portal.depositToAztecPublic(TO, 100, SECRET_HASH);

        assertEq(hook.innerResult(), ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector, "re-entry allowed");
        assertEq(inbox.sent(), 1, "only the outer deposit sent a message");
        assertEq(hook.balanceOf(address(portal)), 100, "reserve");
    }

    function test_withdraw_reentryFromTokenHookReverts() public {
        HookERC20 hook = new HookERC20();
        TokenPortal portal = _portal(hook);
        hook.mint(address(portal), 100);
        address bob = makeAddr("bob");
        hook.arm(
            bob,
            address(portal),
            abi.encodeCall(TokenPortal.withdraw, (bob, 50, false, Epoch.wrap(3), 9, 6, new bytes32[](0)))
        );

        portal.withdraw(bob, 50, false, Epoch.wrap(3), 9, 5, new bytes32[](0));

        assertEq(hook.innerResult(), ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector, "re-entry allowed");
        assertEq(outbox.consumed(), 1, "only the outer withdraw consumed a message");
        assertEq(hook.balanceOf(bob), 50, "paid once");
    }
}
