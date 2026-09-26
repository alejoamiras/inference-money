// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

import {Test} from "forge-std/Test.sol";
import {MockUsdc} from "./mocks/MockUsdc.sol";

contract MockUsdcTest is Test {
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    /// Holders start with ZERO Permit2 allowance, as real Circle USDC holders do, so local deposits exercise the
    /// app's one-time approve path instead of skipping it.
    function test_noPermit2AutoAllowance() public {
        MockUsdc usdc = new MockUsdc();
        usdc.mint(address(this), 5e6);
        assertEq(usdc.allowance(address(this), PERMIT2), 0);
        usdc.approve(PERMIT2, type(uint256).max);
        assertEq(usdc.allowance(address(this), PERMIT2), type(uint256).max);
    }

    function test_metadataMatchesCircleUsdc() public {
        MockUsdc usdc = new MockUsdc();
        assertEq(usdc.decimals(), 6);
        assertEq(usdc.name(), "USD Coin");
        assertEq(usdc.symbol(), "USDC");
    }
}
