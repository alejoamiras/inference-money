// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

import {IERC20} from "@oz/token/ERC20/IERC20.sol";
import {TokenPortal} from "../../src/TokenPortal.sol";
import {Permit2DepositRouter} from "../../src/Permit2DepositRouter.sol";
import {ISignatureTransfer} from "../../src/interfaces/ISignatureTransfer.sol";
import {ITokenPortal} from "../../src/interfaces/ITokenPortal.sol";

// One-rule-deleted mutants for the formal suites' forge canaries: each symbolic proof must FAIL against the
// mutant missing the rule it relies on, or the proof is not actually exercising that rule.

contract PortalWithoutInitOnce is TokenPortal {
    function _requireInitializable() internal view override {
        if (msg.sender != initializer) revert NotInitializer();
    }
}

contract PortalWithoutInitializerCheck is TokenPortal {
    function _requireInitializable() internal view override {
        if (address(registry) != address(0)) revert AlreadyInitialized();
    }
}

contract PortalWithoutCap is TokenPortal {
    function _requireDeposit(uint256) internal pure override {}
}

contract PortalWithoutRouterCheck is TokenPortal {
    function _requireRouter() internal view override {}
}

contract PortalWithoutRecipientCheck is TokenPortal {
    function _requireRecipient(bytes32) internal pure override {}
}

contract RouterWithoutZeroCheck is Permit2DepositRouter {
    constructor(ISignatureTransfer p, ITokenPortal portal, IERC20 token) Permit2DepositRouter(p, portal, token) {}

    function _checkIntent(uint256 amount, bytes32 aztecRecipient, bool isPrivate) internal pure override {
        if (amount > type(uint128).max) revert AmountExceedsL2Max();
        if (isPrivate && aztecRecipient != bytes32(0)) revert PrivateDepositNamesRecipient();
        if (!isPrivate && aztecRecipient == bytes32(0)) revert PublicDepositNeedsRecipient();
    }
}

contract RouterWithoutCap is Permit2DepositRouter {
    constructor(ISignatureTransfer p, ITokenPortal portal, IERC20 token) Permit2DepositRouter(p, portal, token) {}

    function _checkIntent(uint256 amount, bytes32 aztecRecipient, bool isPrivate) internal pure override {
        if (amount == 0) revert ZeroAmount();
        if (isPrivate && aztecRecipient != bytes32(0)) revert PrivateDepositNamesRecipient();
        if (!isPrivate && aztecRecipient == bytes32(0)) revert PublicDepositNeedsRecipient();
    }
}

contract RouterWithoutPrivateRule is Permit2DepositRouter {
    constructor(ISignatureTransfer p, ITokenPortal portal, IERC20 token) Permit2DepositRouter(p, portal, token) {}

    function _checkIntent(uint256 amount, bytes32 aztecRecipient, bool isPrivate) internal pure override {
        if (amount == 0) revert ZeroAmount();
        if (amount > type(uint128).max) revert AmountExceedsL2Max();
        if (!isPrivate && aztecRecipient == bytes32(0)) revert PublicDepositNeedsRecipient();
    }
}

contract RouterWithoutPublicRule is Permit2DepositRouter {
    constructor(ISignatureTransfer p, ITokenPortal portal, IERC20 token) Permit2DepositRouter(p, portal, token) {}

    function _checkIntent(uint256 amount, bytes32 aztecRecipient, bool isPrivate) internal pure override {
        if (amount == 0) revert ZeroAmount();
        if (amount > type(uint128).max) revert AmountExceedsL2Max();
        if (isPrivate && aztecRecipient != bytes32(0)) revert PrivateDepositNamesRecipient();
    }
}

contract RouterWithoutSettleCheck is Permit2DepositRouter {
    constructor(ISignatureTransfer p, ITokenPortal portal, IERC20 token) Permit2DepositRouter(p, portal, token) {}

    function _checkSettled(uint256) internal view override {}
}

contract RouterNamesItself is Permit2DepositRouter {
    constructor(ISignatureTransfer p, ITokenPortal portal, IERC20 token) Permit2DepositRouter(p, portal, token) {}

    function _depositor() internal view override returns (address) {
        return address(this);
    }
}
