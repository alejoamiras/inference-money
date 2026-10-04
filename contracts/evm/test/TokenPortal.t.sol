// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@oz/token/ERC20/IERC20.sol";
import {ReentrancyGuardTransient} from "@oz/utils/ReentrancyGuardTransient.sol";
import {DataStructures} from "@aztec/core/libraries/DataStructures.sol";
import {Hash} from "@aztec/core/libraries/crypto/Hash.sol";
import {Constants} from "@aztec/core/libraries/ConstantsGen.sol";
import {Epoch} from "@aztec/core/libraries/TimeLib.sol";

import {TokenPortal} from "../src/TokenPortal.sol";
import {CapturingInbox, CapturingOutbox, FakeRegistry, FakeRollup} from "./mocks/AztecFakes.sol";
import {StubRouter, initializedPortal} from "./mocks/MockPortal.sol";
import {
    FeeOnTransferERC20,
    HookERC20,
    OverDeliveringERC20,
    PlainERC20,
    SenderSurchargeERC20
} from "./mocks/TestTokens.sol";

/// Direct calls into the portal, bypassing the router: the message formats and the guards hold for anyone who calls
/// it, and only the bound router may name a depositor other than the caller.
contract TokenPortalTest is Test {
    bytes32 internal constant BRIDGE = bytes32(uint256(0x4B));
    bytes32 internal constant TO = bytes32(uint256(0x1234));
    bytes32 internal constant SECRET_HASH = bytes32(uint256(0x5EC));

    address internal alice = makeAddr("alice");
    address internal signer = makeAddr("signer");
    CapturingInbox internal inbox;
    CapturingOutbox internal outbox;
    FakeRegistry internal registry;
    StubRouter internal router;

    function setUp() public {
        inbox = new CapturingInbox();
        outbox = new CapturingOutbox();
        registry = new FakeRegistry(address(new FakeRollup(address(inbox), address(outbox))));
    }

    function _portal(IERC20 token) internal returns (TokenPortal portal) {
        (portal, router) = initializedPortal(address(registry), address(token), BRIDGE);
    }

    /// A portal over a plain token, with `amount` minted to alice and approved.
    function _funded(uint256 amount) internal returns (TokenPortal portal, PlainERC20 token) {
        token = new PlainERC20("Tok", "TOK");
        portal = _portal(token);
        token.mint(alice, amount);
        vm.prank(alice);
        token.approve(address(portal), amount);
    }

    function _publicContent(bytes32 to, uint256 amount, address depositor) internal pure returns (bytes32) {
        return
            Hash.sha256ToField(
                abi.encodeWithSignature("mint_to_public(bytes32,uint256,address)", to, amount, depositor)
            );
    }

    function _privateContent(uint256 amount, address depositor) internal pure returns (bytes32) {
        return Hash.sha256ToField(abi.encodeWithSignature("mint_to_private(uint256,address)", amount, depositor));
    }

    function test_depositPublic_namesTheCaller() public {
        (TokenPortal portal, PlainERC20 token) = _funded(1_000);
        bytes32 content = _publicContent(TO, 1_000, alice);
        vm.expectEmit(address(portal));
        emit TokenPortal.DepositToAztecPublic(
            alice, TO, 1_000, SECRET_HASH, keccak256(abi.encode(content, SECRET_HASH)), 0
        );
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

    function test_depositPrivate_namesTheCaller() public {
        (TokenPortal portal,) = _funded(7);
        bytes32 content = _privateContent(7, alice);
        vm.expectEmit(address(portal));
        emit TokenPortal.DepositToAztecPrivate(alice, 7, SECRET_HASH, keccak256(abi.encode(content, SECRET_HASH)), 0);
        vm.prank(alice);
        portal.depositToAztecPrivate(7, SECRET_HASH);
        assertEq(inbox.lastContentHash(), content);
        assertEq(inbox.lastSecretHash(), SECRET_HASH);
    }

    /// Both deposits return the Inbox's own key and index, read past index 0 so a constant cannot pass.
    function test_deposits_returnTheInboxKeyAndIndex() public {
        (TokenPortal portal,) = _funded(30);
        vm.startPrank(alice);
        portal.depositToAztecPublic(TO, 10, SECRET_HASH);

        (bytes32 key, uint256 index) = portal.depositToAztecPrivate(10, SECRET_HASH);
        assertEq(key, keccak256(abi.encode(_privateContent(10, alice), SECRET_HASH)), "private key");
        assertEq(index, 1, "private index");

        (key, index) = portal.depositToAztecPublic(TO, 10, SECRET_HASH);
        assertEq(key, keccak256(abi.encode(_publicContent(TO, 10, alice), SECRET_HASH)), "public key");
        assertEq(index, 2, "public index");
        vm.stopPrank();
    }

    /// The router pays, and the message and the event name the signer it passes, never the router.
    function test_depositFor_namesTheRoutersDepositor() public {
        PlainERC20 token = new PlainERC20("Tok", "TOK");
        TokenPortal portal = _portal(token);
        token.mint(address(router), 30);
        vm.startPrank(address(router));
        token.approve(address(portal), 30);

        bytes32 pub = _publicContent(TO, 10, signer);
        vm.expectEmit(address(portal));
        emit TokenPortal.DepositToAztecPublic(signer, TO, 10, SECRET_HASH, keccak256(abi.encode(pub, SECRET_HASH)), 0);
        portal.depositToAztecPublicFor(signer, TO, 10, SECRET_HASH);
        assertEq(inbox.lastContentHash(), pub, "the public message names the signer");

        bytes32 priv = _privateContent(20, signer);
        vm.expectEmit(address(portal));
        emit TokenPortal.DepositToAztecPrivate(signer, 20, SECRET_HASH, keccak256(abi.encode(priv, SECRET_HASH)), 1);
        portal.depositToAztecPrivateFor(signer, 20, SECRET_HASH);
        vm.stopPrank();

        assertEq(inbox.lastContentHash(), priv, "the private message names the signer");
        assertEq(token.balanceOf(address(portal)), 30, "the router paid");
    }

    /// Naming a depositor is the router's alone: a funded holder, the initializer and a stranger are all refused
    /// before anything is pulled.
    function test_depositFor_rejectsAnyoneButTheRouter() public {
        (TokenPortal portal, PlainERC20 token) = _funded(100);
        address[3] memory callers = [alice, address(this), makeAddr("stranger")];
        for (uint256 i = 0; i < callers.length; i++) {
            vm.startPrank(callers[i]);
            vm.expectRevert(TokenPortal.NotRouter.selector);
            portal.depositToAztecPublicFor(signer, TO, 100, SECRET_HASH);
            vm.expectRevert(TokenPortal.NotRouter.selector);
            portal.depositToAztecPrivateFor(signer, 100, SECRET_HASH);
            vm.stopPrank();
        }
        assertEq(inbox.sent(), 0, "no message");
        assertEq(token.balanceOf(alice), 100, "nothing pulled");
    }

    /// A router bound to another portal or token would deposit against the wrong reserve, so `initialize` refuses it
    /// and binds nothing; the router naming both is accepted.
    function test_initialize_refusesARouterBoundElsewhere() public {
        PlainERC20 token = new PlainERC20("Tok", "TOK");
        TokenPortal portal = new TokenPortal();
        address otherPortal = address(new StubRouter(makeAddr("other portal"), address(token)));
        address otherToken = address(new StubRouter(address(portal), makeAddr("other token")));
        StubRouter bound = new StubRouter(address(portal), address(token));

        vm.expectRevert(TokenPortal.RouterMismatch.selector);
        portal.initialize(address(registry), address(token), BRIDGE, otherPortal);
        vm.expectRevert(TokenPortal.RouterMismatch.selector);
        portal.initialize(address(registry), address(token), BRIDGE, otherToken);
        // No code, no binding to read.
        vm.expectRevert();
        portal.initialize(address(registry), address(token), BRIDGE, makeAddr("eoa"));
        assertEq(address(portal.registry()), address(0), "a refused initialize bound a registry");

        portal.initialize(address(registry), address(token), BRIDGE, address(bound));
        assertEq(portal.router(), address(bound), "router");
    }

    /// Each binding is checked on its own: with the other right, any wrong portal or token is refused. Random values
    /// fall on both sides of the right address, so a comparison weakened to `<` or `>` fails here.
    function testFuzz_initialize_refusesAMismatchedRouter(address other) public {
        PlainERC20 token = new PlainERC20("Tok", "TOK");
        TokenPortal wrongPortal = new TokenPortal();
        TokenPortal wrongToken = new TokenPortal();
        vm.assume(other != address(wrongPortal) && other != address(token));
        address namesOtherPortal = address(new StubRouter(other, address(token)));
        address namesOtherToken = address(new StubRouter(address(wrongToken), other));

        vm.expectRevert(TokenPortal.RouterMismatch.selector);
        wrongPortal.initialize(address(registry), address(token), BRIDGE, namesOtherPortal);
        vm.expectRevert(TokenPortal.RouterMismatch.selector);
        wrongToken.initialize(address(registry), address(token), BRIDGE, namesOtherToken);
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

    /// An Aztec address is a field element: no claim or return could ever name a larger recipient, so the deposit is
    /// refused before anything moves, directly or through the router; the largest field element still deposits.
    function test_depositPublic_refusesARecipientAboveTheField() public {
        (TokenPortal portal, PlainERC20 token) = _funded(1_000);
        bytes32 over = bytes32(Constants.MAX_FIELD_VALUE + 1);
        vm.startPrank(alice);
        vm.expectRevert(TokenPortal.RecipientExceedsFieldMax.selector);
        portal.depositToAztecPublic(over, 1_000, SECRET_HASH);
        vm.expectRevert(TokenPortal.RecipientExceedsFieldMax.selector);
        portal.depositToAztecPublic(bytes32(type(uint256).max), 1_000, SECRET_HASH);
        portal.depositToAztecPublic(bytes32(Constants.MAX_FIELD_VALUE), 1_000, SECRET_HASH);
        vm.stopPrank();

        token.mint(address(router), 1_000);
        vm.startPrank(address(router));
        token.approve(address(portal), 1_000);
        vm.expectRevert(TokenPortal.RecipientExceedsFieldMax.selector);
        portal.depositToAztecPublicFor(signer, over, 1_000, SECRET_HASH);
        vm.stopPrank();

        assertEq(inbox.sent(), 1, "only the in-field deposit sent a message");
        assertEq(token.balanceOf(address(portal)), 1_000, "only the in-field deposit moved funds");
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

    /// The credit must be exact, not merely enough: a token that moves more than asked is refused like one that moves
    /// less.
    function test_deposit_rejectsOverDelivery() public {
        OverDeliveringERC20 gen = new OverDeliveringERC20();
        TokenPortal portal = _portal(gen);
        gen.mint(alice, 1_001);
        vm.startPrank(alice);
        gen.approve(address(portal), 1_000);
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
