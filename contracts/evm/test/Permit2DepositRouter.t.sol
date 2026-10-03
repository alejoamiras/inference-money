// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

import {IERC20} from "@oz/token/ERC20/IERC20.sol";
import {ReentrancyGuardTransient} from "@oz/utils/ReentrancyGuardTransient.sol";

import {Constants} from "@aztec/core/libraries/ConstantsGen.sol";
import {Permit2DepositRouter} from "../src/Permit2DepositRouter.sol";
import {TokenPortal} from "../src/TokenPortal.sol";
import {ISignatureTransfer} from "../src/interfaces/ISignatureTransfer.sol";
import {ITokenPortal} from "../src/interfaces/ITokenPortal.sol";
import {MockPermit2} from "./mocks/MockPermit2.sol";
import {MockTokenPortal} from "./mocks/MockPortal.sol";
import {MockUsdc} from "./mocks/MockUsdc.sol";
import {RouterFixture} from "./mocks/RouterFixture.sol";
import {FeeOnTransferERC20, HookERC20, OverDeliveringERC20, SenderSurchargeERC20} from "./mocks/TestTokens.sol";

contract Permit2DepositRouterTest is RouterFixture {
    MockUsdc internal usdc;

    function setUp() public {
        usdc = new MockUsdc();
        _deployStack(usdc);
        usdc.mint(user, 1_000e6);
    }

    function test_constructor_bindsThePortalAndItsToken() public view {
        assertEq(address(router.PERMIT2()), address(permit2));
        assertEq(address(router.PORTAL()), address(portal));
        assertEq(address(router.TOKEN()), address(usdc));
    }

    function test_depositPublic() public {
        bytes32 content =
            _model(abi.encodeWithSignature("mint_to_public(bytes32,uint256,address)", RECIPIENT, 250e6, user));
        bytes32 expectedKey = keccak256(abi.encode(content, SECRET_HASH));
        vm.expectEmit(address(portal));
        emit TokenPortal.DepositToAztecPublic(user, RECIPIENT, 250e6, SECRET_HASH, expectedKey, 0);
        vm.expectEmit(address(router));
        emit Permit2DepositRouter.Deposit(user, RECIPIENT, expectedKey, 0, 250e6, SECRET_HASH, false);
        (bytes32 key, uint256 index) = _deposit(250e6, false);

        assertEq(key, expectedKey, "key");
        assertEq(index, 0, "index");
        assertTrue(lastMintWasPublic(RECIPIENT, 250e6), "public mint message");
        assertEq(inbox.lastSecretHash(), SECRET_HASH, "secret hash");
        assertEq(usdc.balanceOf(address(portal)), 250e6, "portal reserve");
        assertEq(usdc.balanceOf(user), 750e6, "user paid exactly");
        _assertRouterClean(0);
        _assertPermit2Call(250e6, RECIPIENT, false);
    }

    function test_depositPrivate() public {
        vm.expectEmit(true, false, false, false, address(portal));
        emit TokenPortal.DepositToAztecPrivate(user, 0, 0, 0, 0);
        (, uint256 index) = _deposit(7e6, true);
        assertEq(index, 0, "index");
        assertTrue(lastMintWasPrivate(7e6), "private mint message names the signer and no recipient");
        assertEq(usdc.balanceOf(address(portal)), 7e6);
        _assertRouterClean(0);
        _assertPermit2Call(7e6, bytes32(0), true);
    }

    function test_rejectsZeroAmount() public {
        _expectRejected(0, RECIPIENT, false, Permit2DepositRouter.ZeroAmount.selector);
        _expectRejected(0, bytes32(0), true, Permit2DepositRouter.ZeroAmount.selector);
    }

    function test_rejectsAmountAboveU128() public {
        uint256 over = uint256(type(uint128).max) + 1;
        _expectRejected(over, RECIPIENT, false, Permit2DepositRouter.AmountExceedsL2Max.selector);
        _expectRejected(over, bytes32(0), true, Permit2DepositRouter.AmountExceedsL2Max.selector);
    }

    /// The portal's refusal of a recipient no Aztec address can be unwinds the whole routed deposit, pull included.
    function test_portalRefusesARecipientAboveTheField() public {
        vm.prank(user);
        vm.expectRevert(TokenPortal.RecipientExceedsFieldMax.selector);
        router.deposit(1e6, bytes32(Constants.MAX_FIELD_VALUE + 1), SECRET_HASH, false, 0, 1, hex"");
        assertEq(usdc.balanceOf(user), 1_000e6, "the signer keeps the funds");
        assertEq(inbox.sent(), 0, "no message");
        _assertRouterClean(0);
    }

    function test_rejectsPrivateDepositNamingARecipient() public {
        _expectRejected(1e6, RECIPIENT, true, Permit2DepositRouter.PrivateDepositNamesRecipient.selector);
    }

    function test_rejectsPublicDepositWithoutRecipient() public {
        _expectRejected(1e6, bytes32(0), false, Permit2DepositRouter.PublicDepositNeedsRecipient.selector);
    }

    function test_permit2RejectionBubbles() public {
        permit2.setReject(true);
        vm.prank(user);
        vm.expectRevert(MockPermit2.MockRejected.selector);
        router.deposit(1e6, RECIPIENT, SECRET_HASH, false, 0, 1, hex"");
        assertEq(usdc.balanceOf(user), 1_000e6, "nothing moved");
    }

    /// Tokens donated to the router are never spent and never absorbed: the deposit is exact regardless.
    function test_donationIsNeitherSpentNorAbsorbed() public {
        usdc.mint(address(router), 500e6);
        _deposit(100e6, false);
        assertEq(usdc.balanceOf(address(portal)), 100e6, "portal got exactly the deposit");
        assertEq(usdc.balanceOf(user), 900e6, "user paid exactly");
        _assertRouterClean(500e6);
    }

    /// A token that delivers less than signed is refused at the pull, before the portal sees a wei.
    function test_feeOnTransferRefusedAtThePull() public {
        FeeOnTransferERC20 tax = new FeeOnTransferERC20(1_000);
        _deployStack(tax);
        tax.mint(user, 1_000e6);
        vm.prank(user);
        vm.expectRevert(Permit2DepositRouter.InexactPull.selector);
        router.deposit(100e6, RECIPIENT, SECRET_HASH, false, 0, 1, hex"");
        assertEq(tax.balanceOf(user), 1_000e6, "nothing left the user");
        assertEq(inbox.sent(), 0, "no message");
    }

    /// A token that delivers more than signed is refused by the router's own pull check, before the portal's.
    function test_overDeliveryRefusedAtThePull() public {
        OverDeliveringERC20 gen = new OverDeliveringERC20();
        _deployStack(gen);
        gen.mint(user, 1_000e6);
        vm.prank(user);
        vm.expectRevert(Permit2DepositRouter.InexactPull.selector);
        router.deposit(100e6, RECIPIENT, SECRET_HASH, false, 0, 1, hex"");
    }

    /// A token that charges its sender keeps the pull and the portal's credit exact, but charges the router for its
    /// transfer to the portal: a donation must not pay that fee.
    function test_senderSurchargeCannotSpendDonations() public {
        SenderSurchargeERC20 sur = new SenderSurchargeERC20(100);
        _deployStack(sur);
        sur.mint(user, 101e6);
        sur.mint(address(router), 5e6);
        vm.prank(user);
        vm.expectRevert(Permit2DepositRouter.ResidualBalance.selector);
        router.deposit(100e6, RECIPIENT, SECRET_HASH, false, 0, 1, hex"");
    }

    /// A portal that leaves part of the deposit behind trips the settle check, even with a donation to hide behind.
    function test_residueRefused() public {
        MockTokenPortal shorting = new MockTokenPortal(usdc);
        shorting.setShortBy(1);
        router = new Permit2DepositRouter(ISignatureTransfer(address(permit2)), ITokenPortal(address(shorting)), usdc);
        usdc.mint(address(router), 5e6);
        vm.prank(user);
        vm.expectRevert(Permit2DepositRouter.ResidualBalance.selector);
        router.deposit(100e6, RECIPIENT, SECRET_HASH, false, 0, 1, hex"");
        assertEq(usdc.balanceOf(user), 1_000e6, "nothing left the user");
    }

    /// A hostile token re-entering `deposit` from its transfer hook is refused; the outer deposit is exact.
    function test_reentryFromTokenHookRefused() public {
        HookERC20 hook = new HookERC20();
        _deployStack(hook);
        hook.mint(user, 1_000e6);
        hook.arm(
            address(router),
            address(router),
            abi.encodeCall(Permit2DepositRouter.deposit, (1e6, RECIPIENT, SECRET_HASH, false, 9, 1, hex""))
        );
        _deposit(100e6, false);

        assertEq(hook.innerResult(), ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector, "re-entry allowed");
        assertEq(hook.balanceOf(address(portal)), 100e6, "outer deposit exact");
        assertEq(inbox.sent(), 1, "one message");
        _assertRouterClean(0);
    }

    function test_constructor_refusesCodelessAddresses() public {
        ISignatureTransfer p = ISignatureTransfer(address(permit2));
        ITokenPortal t = ITokenPortal(address(portal));
        vm.expectRevert(Permit2DepositRouter.NotAContract.selector);
        new Permit2DepositRouter(ISignatureTransfer(makeAddr("eoa")), t, usdc);
        vm.expectRevert(Permit2DepositRouter.NotAContract.selector);
        new Permit2DepositRouter(p, ITokenPortal(makeAddr("eoa")), usdc);
        vm.expectRevert(Permit2DepositRouter.NotAContract.selector);
        new Permit2DepositRouter(p, t, IERC20(makeAddr("eoa")));
    }

    function test_gas_depositPublic() public {
        _deposit(1e6, false);
        vm.prank(user);
        router.deposit(1e6, RECIPIENT, SECRET_HASH, false, 1, 1, hex"");
    }

    function test_gas_depositPrivate() public {
        _deposit(1e6, true);
        vm.prank(user);
        router.deposit(1e6, bytes32(0), SECRET_HASH, true, 1, 1, hex"");
    }

    function _expectRejected(uint256 amount, bytes32 recipient, bool isPrivate, bytes4 selector) internal {
        vm.prank(user);
        vm.expectRevert(selector);
        router.deposit(amount, recipient, SECRET_HASH, isPrivate, 0, 1, hex"");
        assertEq(permit2.calls(), 0, "a rejected intent reached Permit2");
    }

    function _assertRouterClean(uint256 donations) internal view {
        assertEq(token.balanceOf(address(router)), donations, "router residue");
        assertEq(token.allowance(address(router), address(portal)), 0, "router allowance residue");
    }

    /// The pull is bound to the caller as owner, the router as spender and recipient, and the signed witness.
    function _assertPermit2Call(uint256 amount, bytes32 recipient, bool isPrivate) internal view {
        assertEq(permit2.lastOwner(), user, "owner is msg.sender");
        assertEq(permit2.lastSpender(), address(router), "spender");
        assertEq(permit2.lastTo(), address(router), "pull lands in the router");
        assertEq(permit2.lastToken(), address(token), "token");
        assertEq(permit2.lastAmount(), amount, "amount");
        assertEq(permit2.lastWitness(), router.hashWitness(recipient, SECRET_HASH, isPrivate), "witness");
        assertEq(permit2.lastWitnessTypeHash(), keccak256(bytes(router.DEPOSIT_WITNESS_TYPE_STRING())), "type string");
    }
}
