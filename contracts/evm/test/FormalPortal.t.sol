// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

import {TokenPortal} from "../src/TokenPortal.sol";
import {CapturingInbox, CapturingOutbox, FakeRegistry, FakeRollup} from "./mocks/AztecFakes.sol";
import {StubRouter, initializedPortal} from "./mocks/MockPortal.sol";
import {
    PortalWithoutCap,
    PortalWithoutInitializerCheck,
    PortalWithoutInitOnce,
    PortalWithoutRouterCheck
} from "./mocks/Mutants.sol";
import {ProofCanary} from "./mocks/ProofCanary.sol";
import {PlainERC20} from "./mocks/TestTokens.sol";

/// SYMBOLIC proofs for the portal's guards, run by halmos (`check_` prefix), not forge. Arguments are symbolic, so
/// each proof covers the whole input domain:
///
///   check_initializedBindingsCannotChange  — a second initialize never rebinds anything, the router included
///   check_initialize_rejectsNonInitializer — no caller but the deployer can make the first initialize
///   check_deposit_rejectsAmountAboveU128   — no deposit above the L2 amount type reaches the Inbox
///   check_depositFor_rejectsNonRouter      — no caller but the bound router can name a depositor
///
/// Every proof asserts the exact revert selector: a bare `catch` would accept a fixture failing for its own reasons.
/// Failures are signalled with assertions only, because halmos cannot observe `revert(string)`. The u128 and router
/// guards run before any sha256, which halmos 0.3.3 cannot model. Each forge canary runs its proof's body against a
/// mutant with that one rule deleted and requires the body to fail on that rule's assertion.
contract FormalPortalTest is ProofCanary {
    address internal constant UNDERLYING_A = address(0xA11CE);
    bytes32 internal constant BRIDGE_A = bytes32(uint256(0x1111));
    address internal constant UNDERLYING_B = address(0xBEEF);
    bytes32 internal constant BRIDGE_B = bytes32(uint256(0x2222));
    string internal constant STRANGER_DEPOSITED = "a stranger named a depositor";

    TokenPortal internal locked;
    StubRouter internal routerA;
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

        (locked, routerA) = initializedPortal(address(regA), UNDERLYING_A, BRIDGE_A);
        fresh = new TokenPortal();

        token = new PlainERC20("Tok", "TOK");
        (funded,) = initializedPortal(address(regA), address(token), BRIDGE_A);
        token.mint(address(this), type(uint256).max);
        token.approve(address(funded), type(uint256).max);
    }

    function check_initializedBindingsCannotChange(
        address candidateUnderlying,
        bytes32 candidateBridge,
        address candidateRouter
    ) public {
        proveInitOnce(locked, candidateUnderlying, candidateBridge, candidateRouter);
    }

    function check_initialize_rejectsNonInitializer(
        address caller,
        address candidateUnderlying,
        bytes32 candidateBridge,
        address candidateRouter
    ) public {
        proveInitializerOnly(fresh, caller, candidateUnderlying, candidateBridge, candidateRouter);
    }

    function check_deposit_rejectsAmountAboveU128(bytes32 to, uint256 amount, bytes32 secretHash) public {
        proveCap(funded, to, amount, secretHash);
    }

    function check_depositFor_rejectsNonRouter(
        address caller,
        address depositor,
        bytes32 to,
        uint256 amount,
        bytes32 secretHash
    ) public {
        proveRouterOnly(funded, caller, depositor, to, amount, secretHash);
    }

    /// `p` was initialized against registry A by this contract, so the call clears the deployer-only guard and meets
    /// the init-once guard alone.
    function proveInitOnce(TokenPortal p, address candidateUnderlying, bytes32 candidateBridge, address candidateRouter)
        public
    {
        try p.initialize(address(regB), candidateUnderlying, candidateBridge, candidateRouter) {
            assertTrue(false, "re-initialized an already-initialized portal");
        } catch (bytes memory reason) {
            assertEq(bytes4(reason), TokenPortal.AlreadyInitialized.selector, "rejected for the wrong reason");
            _assertBoundToA(p);
        }
    }

    /// `p` is uninitialized and was deployed by this contract.
    function proveInitializerOnly(
        TokenPortal p,
        address caller,
        address candidateUnderlying,
        bytes32 candidateBridge,
        address candidateRouter
    ) public {
        vm.assume(caller != address(this));
        vm.prank(caller);
        try p.initialize(address(regB), candidateUnderlying, candidateBridge, candidateRouter) {
            assertTrue(false, "a non-initializer initialized the portal");
        } catch (bytes memory reason) {
            assertEq(bytes4(reason), TokenPortal.NotInitializer.selector, "rejected for the wrong reason");
            assertEq(address(p.registry()), address(0), "a rejected initialize bound a registry");
            assertEq(p.router(), address(0), "a rejected initialize bound a router");
        }
    }

    /// `p` is bound to registry A (so to `inboxA`) and may pull any amount from this contract.
    function proveCap(TokenPortal p, bytes32 to, uint256 amount, bytes32 secretHash) public {
        vm.assume(amount > type(uint128).max);
        uint256 sent = inboxA.sent();
        try p.depositToAztecPublic(to, amount, secretHash) {
            assertTrue(false, "public deposit above u128 succeeded");
        } catch (bytes memory reason) {
            assertEq(bytes4(reason), TokenPortal.AmountExceedsL2Max.selector, "public: rejected for the wrong reason");
        }
        try p.depositToAztecPrivate(amount, secretHash) {
            assertTrue(false, "private deposit above u128 succeeded");
        } catch (bytes memory reason) {
            assertEq(bytes4(reason), TokenPortal.AmountExceedsL2Max.selector, "private: rejected for the wrong reason");
        }
        assertEq(inboxA.sent(), sent, "a message was sent for an unclaimable amount");
    }

    /// `p` is bound to registry A (so to `inboxA`) and to a router other than `caller`.
    function proveRouterOnly(
        TokenPortal p,
        address caller,
        address depositor,
        bytes32 to,
        uint256 amount,
        bytes32 secretHash
    ) public {
        vm.assume(caller != p.router());
        uint256 sent = inboxA.sent();
        uint256 reserve = p.underlying().balanceOf(address(p));
        vm.prank(caller);
        try p.depositToAztecPublicFor(depositor, to, amount, secretHash) {
            assertTrue(false, STRANGER_DEPOSITED);
        } catch (bytes memory reason) {
            assertEq(bytes4(reason), TokenPortal.NotRouter.selector, "public: rejected for the wrong reason");
        }
        vm.prank(caller);
        try p.depositToAztecPrivateFor(depositor, amount, secretHash) {
            assertTrue(false, STRANGER_DEPOSITED);
        } catch (bytes memory reason) {
            assertEq(bytes4(reason), TokenPortal.NotRouter.selector, "private: rejected for the wrong reason");
        }
        assertEq(inboxA.sent(), sent, "a stranger's deposit sent a message");
        assertEq(p.underlying().balanceOf(address(p)), reserve, "a stranger's deposit moved funds");
    }

    function _assertBoundToA(TokenPortal p) internal view {
        FakeRollup rollupA = FakeRollup(regA.getCanonicalRollup());
        assertEq(address(p.registry()), address(regA), "registry rebound");
        assertEq(address(p.underlying()), UNDERLYING_A, "underlying rebound");
        assertEq(p.l2Bridge(), BRIDGE_A, "l2Bridge rebound");
        assertEq(p.router(), address(routerA), "router rebound");
        assertEq(address(p.rollup()), address(rollupA), "rollup rebound");
        assertEq(address(p.outbox()), rollupA.getOutbox(), "outbox rebound");
        assertEq(address(p.inbox()), rollupA.getInbox(), "inbox rebound");
        assertEq(p.rollupVersion(), rollupA.getVersion(), "rollupVersion rebound");
    }

    // ── Canaries (forge) ─────────────────────────────────────────────────────────────────

    function test_canary_initOnce_failsWithoutTheGuard() public {
        PortalWithoutInitOnce mutant = new PortalWithoutInitOnce();
        mutant.initialize(address(regA), UNDERLYING_A, BRIDGE_A, address(new StubRouter(address(mutant), UNDERLYING_A)));
        address rebound = address(new StubRouter(address(mutant), UNDERLYING_B));
        _assertProofFails(
            abi.encodeCall(this.proveInitOnce, (mutant, UNDERLYING_B, BRIDGE_B, rebound)),
            "re-initialized an already-initialized portal"
        );
    }

    function test_canary_initializerCheck_failsWithoutTheGuard() public {
        PortalWithoutInitializerCheck mutant = new PortalWithoutInitializerCheck();
        address router = address(new StubRouter(address(mutant), UNDERLYING_B));
        _assertProofFails(
            abi.encodeCall(this.proveInitializerOnly, (mutant, makeAddr("attacker"), UNDERLYING_B, BRIDGE_B, router)),
            "a non-initializer initialized the portal"
        );
    }

    function test_canary_u128Cap_failsWithoutTheGuard() public {
        PortalWithoutCap mutant = new PortalWithoutCap();
        mutant.initialize(
            address(regA), address(token), BRIDGE_A, address(new StubRouter(address(mutant), address(token)))
        );
        token.approve(address(mutant), type(uint256).max);
        _assertProofFails(
            abi.encodeCall(this.proveCap, (mutant, bytes32(uint256(1)), uint256(type(uint128).max) + 1, bytes32(0))),
            "public deposit above u128 succeeded"
        );
    }

    /// The stranger holds and approves the amount, so with the guard deleted nothing else stops the deposit.
    function test_canary_routerCheck_failsWithoutTheGuard() public {
        PortalWithoutRouterCheck mutant = new PortalWithoutRouterCheck();
        mutant.initialize(
            address(regA), address(token), BRIDGE_A, address(new StubRouter(address(mutant), address(token)))
        );
        address stranger = makeAddr("stranger");
        token.transfer(stranger, 2e6);
        vm.prank(stranger);
        token.approve(address(mutant), 2e6);
        _assertProofFails(
            abi.encodeCall(
                this.proveRouterOnly, (mutant, stranger, makeAddr("victim"), bytes32(uint256(1)), 1e6, bytes32(0))
            ),
            STRANGER_DEPOSITED
        );
    }

    /// Registry B binds every field of a fresh portal: the init-once proof never reaches B on a passing run, so this
    /// is what says B is a working registry rather than an untested one.
    function test_canary_registryBBindsAFreshPortal() public {
        address router = address(new StubRouter(address(fresh), UNDERLYING_B));
        fresh.initialize(address(regB), UNDERLYING_B, BRIDGE_B, router);
        assertEq(address(fresh.registry()), address(regB), "registry");
        assertEq(address(fresh.underlying()), UNDERLYING_B, "underlying");
        assertEq(fresh.l2Bridge(), BRIDGE_B, "l2Bridge");
        assertEq(fresh.router(), router, "router");
        assertEq(address(fresh.rollup()), address(rollupB), "rollup");
        assertEq(address(fresh.outbox()), rollupB.getOutbox(), "outbox");
        assertEq(address(fresh.inbox()), rollupB.getInbox(), "inbox");
        assertEq(fresh.rollupVersion(), rollupB.getVersion(), "rollupVersion");
    }

    /// Exactly u128 max still deposits: the cap proof's assumption is the only thing excluding success.
    function test_canary_u128MaxDeposits() public {
        uint256 sent = inboxA.sent();
        funded.depositToAztecPublic(bytes32(uint256(1)), type(uint128).max, bytes32(0));
        assertEq(inboxA.sent(), sent + 1);
    }

    /// The bound router does deposit for someone else: the router proof's assumption is the only thing excluding
    /// success.
    function test_canary_theRouterDepositsFor() public {
        address router = funded.router();
        token.transfer(router, 1e6);
        vm.startPrank(router);
        token.approve(address(funded), 1e6);
        uint256 sent = inboxA.sent();
        funded.depositToAztecPrivateFor(makeAddr("signer"), 1e6, bytes32(0));
        vm.stopPrank();
        assertEq(inboxA.sent(), sent + 1);
    }
}
