// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

import {Test} from "forge-std/Test.sol";
import {TokenPortal} from "../src/TokenPortal.sol";
import {CapturingInbox, CapturingOutbox, FakeRegistry, FakeRollup} from "./mocks/AztecFakes.sol";
import {PortalWithoutCap, PortalWithoutInitializerCheck, PortalWithoutInitOnce} from "./mocks/Mutants.sol";
import {PlainERC20} from "./mocks/TestTokens.sol";

/// SYMBOLIC proofs for the portal's guards, run by halmos (`check_` prefix), not forge. Arguments are symbolic, so
/// each proof covers the whole input domain:
///
///   check_initializedBindingsCannotChange  — a second initialize never rebinds anything (F-001, init-once)
///   check_initialize_rejectsNonInitializer — no caller but the deployer can make the first initialize (F-001)
///   check_deposit_rejectsAmountAboveU128   — no deposit above the L2 amount type reaches the Inbox (D19)
///
/// Every proof asserts the exact revert selector: a bare `catch` would accept a fixture failing for its own reasons.
/// Failures are signalled with assertions only, because halmos cannot observe `revert(string)`. The u128 guard runs
/// before any sha256, which halmos 0.3.3 cannot model. The forge canaries below run each proof's body against a
/// mutant with that one rule deleted and require the forbidden outcome, so no proof can pass vacuously.
contract FormalPortalTest is Test {
    address internal constant UNDERLYING_A = address(0xA11CE);
    bytes32 internal constant BRIDGE_A = bytes32(uint256(0x1111));

    TokenPortal internal locked;
    TokenPortal internal fresh;
    TokenPortal internal funded;
    PlainERC20 internal token;
    FakeRegistry internal regA;
    FakeRegistry internal regB;
    CapturingInbox internal inboxA;
    FakeRollup internal rollupB;

    function setUp() public {
        inboxA = new CapturingInbox();
        regA = new FakeRegistry(address(new FakeRollup(address(inboxA), address(new CapturingOutbox()))));
        rollupB = new FakeRollup(address(new CapturingInbox()), address(new CapturingOutbox()));
        regB = new FakeRegistry(address(rollupB));

        locked = new TokenPortal();
        locked.initialize(address(regA), UNDERLYING_A, BRIDGE_A);
        fresh = new TokenPortal();

        token = new PlainERC20("Tok", "TOK");
        funded = new TokenPortal();
        funded.initialize(address(regA), address(token), BRIDGE_A);
        token.mint(address(this), type(uint256).max);
        token.approve(address(funded), type(uint256).max);
    }

    /// Calling directly, with no symbolic caller, aims the proof at the init-once guard: this contract deployed
    /// `locked`, so the call clears the deployer-only guard first.
    function check_initializedBindingsCannotChange(address candidateUnderlying, bytes32 candidateBridge) public {
        try locked.initialize(address(regB), candidateUnderlying, candidateBridge) {
            assertTrue(false, "re-initialized an already-initialized portal");
        } catch (bytes memory reason) {
            assertEq(bytes4(reason), TokenPortal.AlreadyInitialized.selector, "rejected for the wrong reason");
            _assertBoundToA(locked);
        }
    }

    function check_initialize_rejectsNonInitializer(
        address caller,
        address candidateUnderlying,
        bytes32 candidateBridge
    ) public {
        vm.assume(caller != address(this));
        vm.prank(caller);
        try fresh.initialize(address(regB), candidateUnderlying, candidateBridge) {
            assertTrue(false, "a non-initializer initialized the portal");
        } catch (bytes memory reason) {
            assertEq(bytes4(reason), TokenPortal.NotInitializer.selector, "rejected for the wrong reason");
            assertEq(address(fresh.registry()), address(0), "a rejected initialize bound a registry");
        }
    }

    function check_deposit_rejectsAmountAboveU128(bytes32 to, uint256 amount, bytes32 secretHash) public {
        vm.assume(amount > type(uint128).max);
        uint256 sent = inboxA.sent();
        try funded.depositToAztecPublic(to, amount, secretHash) {
            assertTrue(false, "public deposit above u128 succeeded");
        } catch (bytes memory reason) {
            assertEq(bytes4(reason), TokenPortal.AmountExceedsL2Max.selector, "public: rejected for the wrong reason");
        }
        try funded.depositToAztecPrivate(amount, secretHash) {
            assertTrue(false, "private deposit above u128 succeeded");
        } catch (bytes memory reason) {
            assertEq(bytes4(reason), TokenPortal.AmountExceedsL2Max.selector, "private: rejected for the wrong reason");
        }
        assertEq(inboxA.sent(), sent, "a message was sent for an unclaimable amount");
    }

    function _assertBoundToA(TokenPortal p) internal view {
        FakeRollup rollupA = FakeRollup(regA.getCanonicalRollup());
        assertEq(address(p.registry()), address(regA), "registry rebound");
        assertEq(address(p.underlying()), UNDERLYING_A, "underlying rebound");
        assertEq(p.l2Bridge(), BRIDGE_A, "l2Bridge rebound");
        assertEq(address(p.rollup()), address(rollupA), "rollup rebound");
        assertEq(address(p.outbox()), rollupA.getOutbox(), "outbox rebound");
        assertEq(address(p.inbox()), rollupA.getInbox(), "inbox rebound");
        assertEq(p.rollupVersion(), rollupA.getVersion(), "rollupVersion rebound");
    }

    // ── Canaries (forge) ─────────────────────────────────────────────────────────────────

    /// Registry B binds every field of a fresh portal: the init-once proof never reaches B on a passing run, so this
    /// is what says B is a working registry rather than an untested one.
    function test_canary_registryBBindsAFreshPortal() public {
        fresh.initialize(address(regB), address(0xBEEF), bytes32(uint256(0x2222)));
        assertEq(address(fresh.registry()), address(regB), "registry");
        assertEq(address(fresh.underlying()), address(0xBEEF), "underlying");
        assertEq(fresh.l2Bridge(), bytes32(uint256(0x2222)), "l2Bridge");
        assertEq(address(fresh.rollup()), address(rollupB), "rollup");
        assertEq(address(fresh.outbox()), rollupB.getOutbox(), "outbox");
        assertEq(address(fresh.inbox()), rollupB.getInbox(), "inbox");
        assertEq(fresh.rollupVersion(), rollupB.getVersion(), "rollupVersion");
    }

    function test_canary_initOnce_failsWithoutTheGuard() public {
        PortalWithoutInitOnce mutant = new PortalWithoutInitOnce();
        mutant.initialize(address(regA), UNDERLYING_A, BRIDGE_A);
        mutant.initialize(address(regB), address(0xBEEF), bytes32(uint256(0x2222)));
        assertEq(address(mutant.registry()), address(regB), "the mutant must rebind what the proof forbids");
    }

    function test_canary_initializerCheck_failsWithoutTheGuard() public {
        PortalWithoutInitializerCheck mutant = new PortalWithoutInitializerCheck();
        vm.prank(makeAddr("attacker"));
        mutant.initialize(address(regB), address(0xBEEF), bytes32(uint256(0x2222)));
        assertEq(address(mutant.registry()), address(regB), "the mutant must accept the front-run the proof forbids");
    }

    function test_canary_u128Cap_failsWithoutTheGuard() public {
        PortalWithoutCap mutant = new PortalWithoutCap();
        mutant.initialize(address(regA), address(token), BRIDGE_A);
        token.approve(address(mutant), type(uint256).max);
        uint256 sent = inboxA.sent();
        mutant.depositToAztecPrivate(uint256(type(uint128).max) + 1, bytes32(0));
        assertEq(inboxA.sent(), sent + 1, "the mutant must send the message the proof forbids");
    }

    /// Exactly u128 max still deposits: the cap proof's assumption is the only thing excluding success.
    function test_canary_u128MaxDeposits() public {
        uint256 sent = inboxA.sent();
        funded.depositToAztecPublic(bytes32(uint256(1)), type(uint128).max, bytes32(0));
        assertEq(inboxA.sent(), sent + 1);
    }
}
