// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

import {Test} from "forge-std/Test.sol";
import {DataStructures} from "@aztec/core/libraries/DataStructures.sol";
import {Epoch} from "@aztec/core/libraries/TimeLib.sol";
import {TokenPortal} from "../src/TokenPortal.sol";
import {CapturingInbox, CapturingOutbox, FakeRegistry, FakeRollup} from "./mocks/AztecFakes.sol";
import {MockUsdc} from "./mocks/MockUsdc.sol";

/// Content-hash ROUNDTRIP fuzzing for the real portal: for arbitrary inputs, the hash committed into the L1<>L2
/// message must equal an INDEPENDENT model (`sha256(preimage) >> 8`, computed without the Aztec Hash library the
/// portal itself uses, which would make the assertion a tautology). The keystone pins three points; this pins the
/// whole input domain.
contract PortalRoundtripFuzzTest is Test {
    bytes32 internal constant BRIDGE = bytes32(uint256(0x1111));
    uint256 internal constant FUNDS = 1_000_000 * 1e6;

    CapturingInbox internal inbox;
    CapturingOutbox internal outbox;
    TokenPortal internal portal;
    MockUsdc internal usdc;

    function _model(bytes memory preimage) internal pure returns (bytes32) {
        return bytes32(uint256(sha256(preimage)) >> 8);
    }

    function setUp() public {
        inbox = new CapturingInbox();
        outbox = new CapturingOutbox();
        usdc = new MockUsdc();
        portal = new TokenPortal();
        portal.initialize(
            address(new FakeRegistry(address(new FakeRollup(address(inbox), address(outbox))))), address(usdc), BRIDGE
        );
        usdc.mint(address(this), FUNDS);
        usdc.approve(address(portal), type(uint256).max);
        usdc.mint(address(portal), FUNDS);
    }

    function testFuzz_depositPublic_contentHashMatchesIndependentModel(bytes32 to, uint256 amount, bytes32 secret)
        public
    {
        amount = bound(amount, 1, FUNDS);
        portal.depositToAztecPublic(to, amount, secret);
        bytes memory preimage = abi.encodeWithSignature("mint_to_public(bytes32,uint256)", to, amount);
        assertEq(inbox.lastContentHash(), _model(preimage), "public content hash drifted");
        assertEq(inbox.lastSecretHash(), secret, "secret hash not forwarded");
        assertEq(inbox.lastVersion(), portal.rollupVersion(), "rollup version not forwarded");
        assertEq(inbox.lastBridge(), BRIDGE, "l2Bridge actor mismatch");
    }

    function testFuzz_depositPrivate_contentHashMatchesIndependentModel(uint256 amount, bytes32 secret) public {
        amount = bound(amount, 1, FUNDS);
        portal.depositToAztecPrivate(amount, secret);
        bytes memory preimage = abi.encodeWithSignature("mint_to_private(uint256)", amount);
        assertEq(inbox.lastContentHash(), _model(preimage), "private content hash drifted");
        assertEq(inbox.lastSecretHash(), secret, "secret hash not forwarded");
    }

    function testFuzz_withdraw_messageReconstructionMatchesIndependentModel(
        address recipient,
        uint256 amount,
        bool withCaller,
        address callerOnL1
    ) public {
        amount = bound(amount, 1, FUNDS);
        vm.assume(recipient != address(0) && recipient != address(portal));
        // The capturing outbox authorizes any caller, so any caller may drive the reconstruction.
        address caller = withCaller ? callerOnL1 : address(0);
        vm.prank(caller);
        portal.withdraw(recipient, amount, withCaller, Epoch.wrap(7), 3, 42, new bytes32[](0));

        DataStructures.L2ToL1Msg memory m = outbox.lastMsg();
        bytes memory preimage = abi.encodeWithSignature("withdraw(address,uint256,address)", recipient, amount, caller);
        assertEq(m.content, _model(preimage), "withdraw content drifted");
        assertEq(m.sender.actor, BRIDGE, "sender actor != l2Bridge");
        assertEq(m.sender.version, portal.rollupVersion(), "sender version != pinned rollup version");
        assertEq(m.recipient.actor, address(portal), "recipient actor != portal");
        assertEq(m.recipient.chainId, block.chainid, "recipient chain id mismatch");
    }
}
