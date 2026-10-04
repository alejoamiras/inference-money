// SPDX-License-Identifier: MIT
pragma solidity >=0.8.27 <0.9.0;

import "../Base.sol";
import {Properties} from "../Properties.sol";

/// @notice Handles the interaction with Permit2DepositRouter. Permit2 is the project's recording mock: it never
/// checks the signature (the Sepolia fork suite pins the real one), so `nonce`, `deadline` and `signature` are inert.
abstract contract Permit2DepositRouterHandler is Properties {
    // ――――――――――――――――――――――――― Clamped ――――――――――――――――――――――――――

    /// A well-formed intent: amount in (0, 1M USDC], recipient zero iff private, a field-sized secret hash.
    function permit2DepositRouter_deposit_clamped(
        uint256 amount,
        uint256 accountSeed,
        bytes32 secretHash,
        bool isPrivate,
        uint256 nonce
    ) public {
        amount = clampBetween(amount, 1, MAX_REALISTIC_AMOUNT);
        _ensureFunds(actor, amount);
        bytes32 recipient = isPrivate ? bytes32(0) : toL2Account(accountSeed);
        bytes32 secret = _toField(secretHash);
        permit2DepositRouter_deposit(amount, recipient, secret, isPrivate, nonce, block.timestamp + 1, "");
    }

    /// Boundary stress: the largest fundable amount, the L2 side's u128 ceiling while the mock supply allows.
    function permit2DepositRouter_deposit_maxAmount(uint256 accountSeed, bool isPrivate) public {
        uint256 amount = _largestFundable(actor);
        if (amount == 0) return;
        bytes32 recipient = isPrivate ? bytes32(0) : toL2Account(accountSeed);
        permit2DepositRouter_deposit(amount, recipient, bytes32(0), isPrivate, 0, block.timestamp + 1, "");
    }

    /// Malformed intents (zero, over u128, a private deposit naming a recipient, a public one naming none) must never
    /// move funds or message anything.
    function permit2DepositRouter_deposit_malformed(uint8 kind, uint256 amount, bytes32 recipient) public {
        kind = uint8(kind % 4);
        bool isPrivate;
        bytes4 refusal;
        if (kind == 0) {
            amount = 0;
            recipient = L2_ACCOUNTS[0];
            refusal = Permit2DepositRouter.ZeroAmount.selector;
        } else if (kind == 1) {
            amount = uint256(type(uint128).max) + 1 + (amount % 1e18);
            recipient = L2_ACCOUNTS[0];
            refusal = Permit2DepositRouter.AmountExceedsL2Max.selector;
        } else if (kind == 2) {
            amount = clampBetween(amount, 1, MAX_REALISTIC_AMOUNT);
            isPrivate = true;
            if (recipient == bytes32(0)) recipient = L2_ACCOUNTS[1];
            refusal = Permit2DepositRouter.PrivateDepositNamesRecipient.selector;
        } else {
            amount = clampBetween(amount, 1, MAX_REALISTIC_AMOUNT);
            recipient = bytes32(0);
            refusal = Permit2DepositRouter.PublicDepositNeedsRecipient.selector;
        }
        // Over u128 stays unfunded (funding it would only drain the capped mock supply), so a missing cap would revert
        // on the pull; the exact selector is what proves the rule refused.
        if (kind != 1) _ensureFunds(actor, amount);
        uint256 portalBefore = usdc.balanceOf(address(portal));
        uint256 sentBefore = inbox.sent();
        uint256 consumed = _noopBegin();
        vm.prank(actor);
        try router.deposit(amount, recipient, bytes32(0), isPrivate, 0, block.timestamp + 1, "") {
            ghosts.boundaryAccepted++;
        } catch (bytes memory reason) {
            _requireRefusal(reason, refusal);
        }
        if (usdc.balanceOf(address(portal)) != portalBefore || inbox.sent() != sentBefore) ghosts.boundaryAccepted++;
        _noopEnd(consumed);
        if (kind == 0) property_zeroAmountSafe();
    }

    function permit2DepositRouter_secondary(uint256 amount, bool isPrivate) public {
        _permit2DepositRouter_rejectedPermit(amount, isPrivate);
    }

    // ―――――――――――――――――――――――― Unclamped ―――――――――――――――――――――――――

    function permit2DepositRouter_deposit(
        uint256 amount,
        bytes32 aztecRecipient,
        bytes32 secretHash,
        bool isPrivate,
        uint256 nonce,
        uint256 deadline,
        bytes memory signature
    ) public asActor {
        uint256 callsBefore = permit2.calls();
        snapshotBefore();
        (, uint256 index) = router.deposit(amount, aztecRecipient, secretHash, isPrivate, nonce, deadline, signature);
        _afterRouterDeposit(actor, aztecRecipient, amount, isPrivate);
        snapshotAfter();
        property_routerDepositPost(amount);
        property_routerPermit2Binding(callsBefore, amount, aztecRecipient, secretHash, isPrivate, nonce, deadline);
        property_secretHashPassthrough(secretHash);
        property_inboxIndexAdvances(index);
        property_depositWithdrawIsolation(true);
        _universalChecks(true, false);
    }

    /// Model update after a successful router deposit by signer `depositor`.
    function _afterRouterDeposit(address depositor, bytes32 aztecRecipient, uint256 amount, bool isPrivate) internal {
        _recordDeposit(depositor, aztecRecipient, amount, isPrivate);
        ghosts.routerDeposited += amount;
        _flagInexactDeposit(amount);
    }

    /// Permit2 refusing the pull (bad signature, spent nonce, expired deadline) must abort the whole deposit.
    function _permit2DepositRouter_rejectedPermit(uint256 amount, bool isPrivate) internal {
        amount = clampBetween(amount, 1, MAX_REALISTIC_AMOUNT);
        _ensureFunds(actor, amount);
        permit2.setReject(true);
        uint256 consumed = _noopBegin();
        vm.prank(actor);
        try router.deposit(amount, isPrivate ? bytes32(0) : L2_ACCOUNTS[0], bytes32(0), isPrivate, 0, 1, "") {
            ghosts.permit2RejectBypassed++;
        } catch {}
        permit2.setReject(false);
        _noopEnd(consumed);
    }
}
