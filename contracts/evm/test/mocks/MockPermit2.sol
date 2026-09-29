// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

import {IERC20} from "@oz/token/ERC20/IERC20.sol";
import {SafeERC20} from "@oz/token/ERC20/utils/SafeERC20.sol";
import {ISignatureTransfer} from "../../src/interfaces/ISignatureTransfer.sol";

/// Success-always Permit2 that records what it was handed and can be told to reject. It never checks a signature:
/// signature validity is Permit2's own domain, pinned by the Sepolia fork suite against the real contract. It does
/// keep Permit2's `requestedAmount <= permitted.amount` rule and pulls with a safe `transferFrom`, as Permit2 does once
/// the owner has approved it.
contract MockPermit2 is ISignatureTransfer {
    error MockRejected();
    error InvalidAmount(uint256 maxAmount);

    bytes32 public lastWitness;
    bytes32 public lastWitnessTypeHash;
    address public lastOwner;
    address public lastSpender;
    address public lastToken;
    address public lastTo;
    uint256 public lastAmount;
    uint256 public lastNonce;
    uint256 public lastDeadline;
    uint256 public calls;
    bool public rejectNext;

    function setReject(bool v) external {
        rejectNext = v;
    }

    function permitWitnessTransferFrom(
        PermitTransferFrom calldata permit,
        SignatureTransferDetails calldata details,
        address owner,
        bytes32 witness,
        string calldata witnessTypeString,
        bytes calldata
    ) external override {
        if (rejectNext) revert MockRejected();
        if (details.requestedAmount > permit.permitted.amount) revert InvalidAmount(permit.permitted.amount);
        lastWitness = witness;
        lastWitnessTypeHash = keccak256(bytes(witnessTypeString));
        lastOwner = owner;
        lastSpender = msg.sender;
        lastToken = permit.permitted.token;
        lastTo = details.to;
        lastAmount = details.requestedAmount;
        lastNonce = permit.nonce;
        lastDeadline = permit.deadline;
        calls++;
        SafeERC20.safeTransferFrom(IERC20(permit.permitted.token), owner, details.to, details.requestedAmount);
    }

    function nonceBitmap(address, uint256) external pure override returns (uint256) {
        return 0;
    }

    function DOMAIN_SEPARATOR() external pure override returns (bytes32) {
        return bytes32(0);
    }
}
