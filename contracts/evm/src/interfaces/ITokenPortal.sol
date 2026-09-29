// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

import {IERC20} from "@oz/token/ERC20/IERC20.sol";

/// @notice The subset of `TokenPortal` the deposit router binds to and calls.
interface ITokenPortal {
    function underlying() external view returns (IERC20);

    function l2Bridge() external view returns (bytes32);

    function depositToAztecPublic(bytes32 _to, uint256 _amount, bytes32 _secretHash) external returns (bytes32, uint256);

    function depositToAztecPrivate(uint256 _amount, bytes32 _secretHashForL2MessageConsumption)
        external
        returns (bytes32, uint256);
}
