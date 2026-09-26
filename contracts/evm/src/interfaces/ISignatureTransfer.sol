// SPDX-License-Identifier: MIT
pragma solidity >=0.8.27;

/// @notice The subset of Uniswap Permit2's `ISignatureTransfer` the router uses (github.com/Uniswap/permit2).
interface ISignatureTransfer {
    struct TokenPermissions {
        address token;
        uint256 amount;
    }

    struct PermitTransferFrom {
        TokenPermissions permitted;
        uint256 nonce;
        uint256 deadline;
    }

    struct SignatureTransferDetails {
        address to;
        uint256 requestedAmount;
    }

    function permitWitnessTransferFrom(
        PermitTransferFrom calldata permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes32 witness,
        string calldata witnessTypeString,
        bytes calldata signature
    ) external;

    function nonceBitmap(address owner, uint256 wordPos) external view returns (uint256);

    function DOMAIN_SEPARATOR() external view returns (bytes32);
}
