// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

/// @notice The subset of `TokenPortal` the deposit router calls.
interface ITokenPortal {
    function depositToAztecPublicFor(address _depositor, bytes32 _to, uint256 _amount, bytes32 _secretHash)
        external
        returns (bytes32, uint256);

    function depositToAztecPrivateFor(address _depositor, uint256 _amount, bytes32 _secretHashForL2MessageConsumption)
        external
        returns (bytes32, uint256);
}
