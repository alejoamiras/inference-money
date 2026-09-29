// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

import {ERC20} from "@oz/token/ERC20/ERC20.sol";

/// @notice Local-network stand-in for Circle USDC: 6 decimals and a permissionless mint. Unlike some faucet tokens
/// it grants Permit2 NO allowance, so holders start where real USDC holders do and the app's one-time
/// `approve(Permit2, max)` path runs locally too. Never deployed to a public network.
contract MockUsdc is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
