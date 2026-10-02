// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

/// @notice The binding `TokenPortal.initialize` checks a deposit router against.
interface IDepositRouter {
    function PORTAL() external view returns (address);

    function TOKEN() external view returns (address);
}
