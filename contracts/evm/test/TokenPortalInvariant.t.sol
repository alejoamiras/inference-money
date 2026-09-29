// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

import {Test} from "forge-std/Test.sol";
import {StdUtils} from "forge-std/StdUtils.sol";
import {Vm} from "forge-std/Vm.sol";
import {Epoch} from "@aztec/core/libraries/TimeLib.sol";

import {TokenPortal} from "../src/TokenPortal.sol";
import {CapturingInbox, CapturingOutbox, FakeRegistry, FakeRollup} from "./mocks/AztecFakes.sol";
import {MockUsdc} from "./mocks/MockUsdc.sol";

/// Cross-call invariants for the portal. A handler drives randomized deposits, withdrawals, donations and hostile
/// re-initializations from several actors; after every sequence:
///
///   I1  reserve == Σdeposits + Σdonations − Σwithdrawals, measured on the real token balance, never ghost-vs-ghost.
///   I2  every successful deposit sent exactly one Inbox message, and nothing else did.
///   I3  the bindings chosen at initialize never change.
contract TokenPortalInvariantTest is Test {
    PortalHandler internal handler;

    function setUp() public {
        handler = new PortalHandler();
        targetContract(address(handler));
    }

    function invariant_reserveEqualsNetFlows() public view {
        assertEq(
            handler.usdc().balanceOf(address(handler.portal())),
            handler.ghostDeposited() + handler.ghostDonated() - handler.ghostWithdrawn(),
            "reserve != deposits + donations - withdrawals"
        );
    }

    function invariant_oneMessagePerDeposit() public view {
        assertEq(handler.inbox().sent(), handler.ghostDepositCount(), "Inbox messages != successful deposits");
    }

    function invariant_bindingsNeverChange() public view {
        TokenPortal portal = handler.portal();
        assertEq(address(portal.registry()), address(handler.registry()), "registry");
        assertEq(address(portal.underlying()), address(handler.usdc()), "underlying");
        assertEq(portal.l2Bridge(), handler.BRIDGE(), "l2Bridge");
        assertEq(address(portal.inbox()), address(handler.inbox()), "inbox");
        assertEq(address(portal.outbox()), address(handler.outbox()), "outbox");
        assertFalse(handler.strangerReinitialized(), "a re-initialize succeeded");
    }
}

contract PortalHandler is StdUtils {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 public constant BRIDGE = bytes32(uint256(0x4B));

    TokenPortal public portal;
    MockUsdc public usdc;
    CapturingInbox public inbox;
    CapturingOutbox public outbox;
    FakeRegistry public registry;
    address[3] private actors = [address(0xA1), address(0xA2), address(0xA3)];

    uint256 public ghostDeposited;
    uint256 public ghostDonated;
    uint256 public ghostWithdrawn;
    uint256 public ghostDepositCount;
    bool public strangerReinitialized;

    constructor() {
        inbox = new CapturingInbox();
        outbox = new CapturingOutbox();
        registry = new FakeRegistry(address(new FakeRollup(address(inbox), address(outbox))));
        usdc = new MockUsdc();
        portal = new TokenPortal();
        portal.initialize(address(registry), address(usdc), BRIDGE);
    }

    function deposit(uint256 actorSeed, uint256 amount, bool isPrivate, bytes32 to) external {
        amount = bound(amount, 1, 1e18);
        address actor = actors[actorSeed % actors.length];
        usdc.mint(actor, amount);
        vm.startPrank(actor);
        usdc.approve(address(portal), amount);
        if (isPrivate) portal.depositToAztecPrivate(amount, bytes32(0));
        else portal.depositToAztecPublic(to, amount, bytes32(0));
        vm.stopPrank();
        ghostDeposited += amount;
        ghostDepositCount++;
    }

    /// The capturing outbox authorizes anything: what is under test is the portal's own accounting.
    function withdraw(uint256 actorSeed, uint256 amount) external {
        uint256 reserve = usdc.balanceOf(address(portal));
        if (reserve == 0) return;
        amount = bound(amount, 1, reserve);
        portal.withdraw(actors[actorSeed % actors.length], amount, false, Epoch.wrap(0), 0, 0, new bytes32[](0));
        ghostWithdrawn += amount;
    }

    function donate(uint256 amount) external {
        amount = bound(amount, 1, 1e18);
        usdc.mint(address(portal), amount);
        ghostDonated += amount;
    }

    function reinitialize(uint256 actorSeed, address underlying_, bytes32 bridge_) external {
        vm.prank(actors[actorSeed % actors.length]);
        try portal.initialize(address(registry), underlying_, bridge_) {
            strangerReinitialized = true;
        } catch {}
        try portal.initialize(address(registry), underlying_, bridge_) {
            strangerReinitialized = true;
        } catch {}
    }
}
