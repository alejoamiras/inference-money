// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

import {Test} from "forge-std/Test.sol";
import {TokenPortal} from "../src/TokenPortal.sol";
import {CapturingInbox, CapturingOutbox, FakeRegistry, FakeRollup} from "./mocks/AztecFakes.sol";

/// Always-on regressions for both initialize guards against the real portal: the fast, readable failure that still runs
/// when halmos does not. `FormalPortal.t.sol` proves the same guards over all arguments and callers.
contract PortalReinitTest is Test {
    address internal constant USDC = address(0xA11CE);
    bytes32 internal constant BRIDGE = bytes32(uint256(0x1111));

    function _registry() internal returns (FakeRegistry) {
        return new FakeRegistry(address(new FakeRollup(address(new CapturingInbox()), address(new CapturingOutbox()))));
    }

    function test_initializeIsOnceOnly() public {
        TokenPortal portal = new TokenPortal();
        FakeRegistry reg = _registry();
        portal.initialize(address(reg), USDC, BRIDGE);
        assertEq(address(portal.underlying()), USDC, "first init sets underlying");
        assertEq(portal.l2Bridge(), BRIDGE, "first init sets l2Bridge");
        assertEq(address(portal.rollup()), reg.getCanonicalRollup(), "first init derives the rollup");

        // Even the initializer cannot rebind: the canonical portal allows exactly this.
        FakeRegistry evil = _registry();
        vm.expectRevert(TokenPortal.AlreadyInitialized.selector);
        portal.initialize(address(evil), address(0xDEAD), bytes32(uint256(0x6666)));

        assertEq(address(portal.registry()), address(reg), "registry unchanged after rejected re-init");
        assertEq(address(portal.underlying()), USDC, "underlying unchanged after rejected re-init");
        assertEq(portal.l2Bridge(), BRIDGE, "l2Bridge unchanged after rejected re-init");
    }

    /// Deploy and initialize are separate transactions: a front-run of the FIRST initialize must revert instead of
    /// binding an attacker registry whose outbox would authorize draining every deposit.
    function test_frontRunOfFirstInitializeReverts() public {
        TokenPortal portal = new TokenPortal();
        FakeRegistry evil = _registry();
        vm.prank(makeAddr("attacker"));
        vm.expectRevert(TokenPortal.NotInitializer.selector);
        portal.initialize(address(evil), address(0xDEAD), bytes32(uint256(0x6666)));

        assertEq(address(portal.registry()), address(0), "attacker bound a registry");
        portal.initialize(address(_registry()), USDC, BRIDGE);
        assertEq(address(portal.underlying()), USDC, "the deployer still initializes after the failed front-run");
    }
}
