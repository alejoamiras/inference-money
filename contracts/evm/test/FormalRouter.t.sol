// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

import {Permit2DepositRouter} from "../src/Permit2DepositRouter.sol";
import {ISignatureTransfer} from "../src/interfaces/ISignatureTransfer.sol";
import {ITokenPortal} from "../src/interfaces/ITokenPortal.sol";
import {MockPermit2} from "./mocks/MockPermit2.sol";
import {MockTokenPortal} from "./mocks/MockPortal.sol";
import {MockUsdc} from "./mocks/MockUsdc.sol";
import {
    RouterWithoutCap,
    RouterWithoutPrivateRule,
    RouterWithoutPublicRule,
    RouterWithoutSettleCheck,
    RouterWithoutZeroCheck
} from "./mocks/Mutants.sol";
import {ProofCanary} from "./mocks/ProofCanary.sol";

/// SYMBOLIC proofs for the router, run by halmos (`check_` prefix), not forge. Arguments are symbolic, so each proof
/// covers its whole input domain rather than sampled points:
///
///   check_deposit_conservesUserFunds        — for ANY amount, donation and portal shortfall: either the deposit is
///                                              exact (user −amount, portal +amount, router untouched, no allowance)
///                                              or it reverts moving nothing, and an honest portal never reverts
///   check_deposit_rejectsZeroAmount
///   check_deposit_rejectsAmountAboveU128
///   check_deposit_privateRequiresZeroRecipient
///   check_deposit_publicRequiresRecipient
///
/// Threat model: Permit2 is the success-always mock (signature validity is Permit2's own domain, pinned by the fork
/// suite) and the portal is the non-hashing mock, because halmos 0.3.3 cannot model sha256. What is proven is the
/// router's own accounting and gating under those semantics. Failures are signalled with assertions only, because
/// halmos cannot observe `revert(string)`. Each forge canary runs its proof's body against a mutant with that one
/// rule deleted and requires the body to fail on that rule's assertion.
contract FormalRouterTest is ProofCanary {
    address internal constant USER = address(0xDA0);
    bytes32 internal constant RECIPIENT = bytes32(uint256(0x1234));
    bytes32 internal constant SECRET_HASH = bytes32(uint256(0x5EC7E7));
    uint256 internal constant USER_BALANCE = 1_000_000 * 1e6;
    uint256 internal constant MAX_DONATION = 1_000 * 1e6;
    string internal constant ACCEPTED = "a forbidden intent was accepted";

    MockUsdc internal usdc;
    MockPermit2 internal permit2;
    MockTokenPortal internal portal;
    Permit2DepositRouter internal router;

    function setUp() public {
        usdc = new MockUsdc();
        permit2 = new MockPermit2();
        portal = new MockTokenPortal(usdc);
        router = new Permit2DepositRouter(ISignatureTransfer(address(permit2)), ITokenPortal(address(portal)));
        usdc.mint(USER, USER_BALANCE);
        vm.prank(USER);
        usdc.approve(address(permit2), type(uint256).max);
    }

    function check_deposit_conservesUserFunds(uint128 amountRaw, uint128 donationRaw, uint128 shortRaw, bool isPrivate)
        public
    {
        proveConservation(router, amountRaw, donationRaw, shortRaw, isPrivate);
    }

    function check_deposit_rejectsZeroAmount(bytes32 recipient, bytes32 secretHash, bool isPrivate) public {
        proveRejectsZero(router, recipient, secretHash, isPrivate);
    }

    function check_deposit_rejectsAmountAboveU128(uint256 amount, bytes32 recipient, bool isPrivate) public {
        proveRejectsAboveU128(router, amount, recipient, isPrivate);
    }

    function check_deposit_privateRequiresZeroRecipient(uint128 amountRaw, bytes32 recipient) public {
        provePrivateNamesNoRecipient(router, amountRaw, recipient);
    }

    function check_deposit_publicRequiresRecipient(uint128 amountRaw) public {
        provePublicNamesRecipient(router, amountRaw);
    }

    function proveConservation(
        Permit2DepositRouter r,
        uint128 amountRaw,
        uint128 donationRaw,
        uint128 shortRaw,
        bool isPrivate
    ) public {
        uint256 amount = bound(uint256(amountRaw), 1, USER_BALANCE);
        uint256 donation = bound(uint256(donationRaw), 0, MAX_DONATION);
        uint256 short = bound(uint256(shortRaw), 0, amount);
        (bool ok, uint256 userPaid, uint256 portalGot, uint256 routerHolds, uint256 allowance) =
            _depositOutcome(r, amount, donation, short, isPrivate);

        if (ok) {
            assertEq(userPaid, amount, "user delta != amount");
            assertEq(portalGot, amount, "portal delta != amount");
        } else {
            assertTrue(short != 0, "an honest deposit reverted");
            assertEq(userPaid, 0, "a reverted deposit moved user funds");
            assertEq(portalGot, 0, "a reverted deposit moved portal funds");
        }
        assertEq(routerHolds, donation, "router balance changed");
        assertEq(allowance, 0, "router left a standing allowance");
    }

    function proveRejectsZero(Permit2DepositRouter r, bytes32 recipient, bytes32 secretHash, bool isPrivate) public {
        _assertRejected(r, 0, recipient, secretHash, isPrivate, Permit2DepositRouter.ZeroAmount.selector);
    }

    function proveRejectsAboveU128(Permit2DepositRouter r, uint256 amount, bytes32 recipient, bool isPrivate) public {
        vm.assume(amount > type(uint128).max);
        _assertRejected(r, amount, recipient, SECRET_HASH, isPrivate, Permit2DepositRouter.AmountExceedsL2Max.selector);
    }

    function provePrivateNamesNoRecipient(Permit2DepositRouter r, uint128 amountRaw, bytes32 recipient) public {
        vm.assume(recipient != bytes32(0));
        uint256 amount = bound(uint256(amountRaw), 1, USER_BALANCE);
        _assertRejected(
            r, amount, recipient, SECRET_HASH, true, Permit2DepositRouter.PrivateDepositNamesRecipient.selector
        );
    }

    function provePublicNamesRecipient(Permit2DepositRouter r, uint128 amountRaw) public {
        uint256 amount = bound(uint256(amountRaw), 1, USER_BALANCE);
        _assertRejected(
            r, amount, bytes32(0), SECRET_HASH, false, Permit2DepositRouter.PublicDepositNeedsRecipient.selector
        );
    }

    /// Runs one deposit and reports what moved, whether or not it reverted.
    function _depositOutcome(Permit2DepositRouter r, uint256 amount, uint256 donation, uint256 short, bool isPrivate)
        internal
        returns (bool ok, uint256 userPaid, uint256 portalGot, uint256 routerHolds, uint256 allowance)
    {
        usdc.mint(address(r), donation);
        portal.setShortBy(short);
        uint256 userBefore = usdc.balanceOf(USER);
        uint256 portalBefore = usdc.balanceOf(address(portal));
        vm.prank(USER);
        try r.deposit(amount, isPrivate ? bytes32(0) : RECIPIENT, SECRET_HASH, isPrivate, 0, 1, hex"") {
            ok = true;
        } catch {}
        userPaid = userBefore - usdc.balanceOf(USER);
        portalGot = usdc.balanceOf(address(portal)) - portalBefore;
        routerHolds = usdc.balanceOf(address(r));
        allowance = usdc.allowance(address(r), address(portal));
    }

    function _assertRejected(
        Permit2DepositRouter r,
        uint256 amount,
        bytes32 recipient,
        bytes32 secretHash,
        bool isPrivate,
        bytes4 selector
    ) internal {
        uint256 userBefore = usdc.balanceOf(USER);
        vm.prank(USER);
        try r.deposit(amount, recipient, secretHash, isPrivate, 0, 1, hex"") {
            assertTrue(false, ACCEPTED);
        } catch (bytes memory reason) {
            assertEq(bytes4(reason), selector, "rejected for the wrong reason");
        }
        assertEq(usdc.balanceOf(USER), userBefore, "a rejected intent moved funds");
        assertEq(permit2.calls(), 0, "a rejected intent reached Permit2");
    }

    // ── Canaries (forge) ─────────────────────────────────────────────────────────────────

    function _mutantBase() internal view returns (ISignatureTransfer, ITokenPortal) {
        return (ISignatureTransfer(address(permit2)), ITokenPortal(address(portal)));
    }

    /// With the settle check deleted, a portal pulling 1 short leaves it in the router and the portal underpaid.
    function test_canary_conservation_failsWithoutTheSettleCheck() public {
        (ISignatureTransfer p, ITokenPortal t) = _mutantBase();
        RouterWithoutSettleCheck mutant = new RouterWithoutSettleCheck(p, t);
        _assertProofFails(
            abi.encodeCall(this.proveConservation, (mutant, 100e6, 5e6, 1, false)), "portal delta != amount"
        );
    }

    /// The real router refuses the same short pull: the proof's revert branch is reachable, not vacuous.
    function test_canary_conservation_shortPullReverts() public {
        (bool ok,,, uint256 routerHolds,) = _depositOutcome(router, 100e6, 5e6, 1, false);
        assertFalse(ok);
        assertEq(routerHolds, 5e6);
    }

    function test_canary_zeroAmount_failsWithoutTheGuard() public {
        (ISignatureTransfer p, ITokenPortal t) = _mutantBase();
        RouterWithoutZeroCheck mutant = new RouterWithoutZeroCheck(p, t);
        _assertProofFails(abi.encodeCall(this.proveRejectsZero, (mutant, RECIPIENT, SECRET_HASH, false)), ACCEPTED);
    }

    function test_canary_u128Cap_failsWithoutTheGuard() public {
        (ISignatureTransfer p, ITokenPortal t) = _mutantBase();
        RouterWithoutCap mutant = new RouterWithoutCap(p, t);
        uint256 over = uint256(type(uint128).max) + 1;
        usdc.mint(USER, over);
        _assertProofFails(abi.encodeCall(this.proveRejectsAboveU128, (mutant, over, RECIPIENT, false)), ACCEPTED);
    }

    function test_canary_privateRule_failsWithoutTheGuard() public {
        (ISignatureTransfer p, ITokenPortal t) = _mutantBase();
        RouterWithoutPrivateRule mutant = new RouterWithoutPrivateRule(p, t);
        _assertProofFails(abi.encodeCall(this.provePrivateNamesNoRecipient, (mutant, 1e6, RECIPIENT)), ACCEPTED);
    }

    function test_canary_publicRule_failsWithoutTheGuard() public {
        (ISignatureTransfer p, ITokenPortal t) = _mutantBase();
        RouterWithoutPublicRule mutant = new RouterWithoutPublicRule(p, t);
        _assertProofFails(abi.encodeCall(this.provePublicNamesRecipient, (mutant, 1e6)), ACCEPTED);
    }
}
