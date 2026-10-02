// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

import {Test, Vm} from "forge-std/Test.sol";
import {IERC20} from "@oz/token/ERC20/IERC20.sol";
import {IRegistry} from "@aztec/governance/interfaces/IRegistry.sol";
import {IRollup} from "@aztec/core/interfaces/IRollup.sol";
import {IInbox} from "@aztec/core/interfaces/messagebridge/IInbox.sol";
import {DataStructures} from "@aztec/core/libraries/DataStructures.sol";
import {Hash} from "@aztec/core/libraries/crypto/Hash.sol";

import {Permit2DepositRouter} from "../src/Permit2DepositRouter.sol";
import {TokenPortal} from "../src/TokenPortal.sol";
import {ISignatureTransfer} from "../src/interfaces/ISignatureTransfer.sol";
import {ITokenPortal} from "../src/interfaces/ITokenPortal.sol";
import {Permit2Digest} from "./mocks/Permit2Digest.sol";

/// Permit2's own errors (Uniswap/permit2 SignatureTransfer + SignatureVerification).
interface IPermit2Errors {
    error InvalidNonce();
    error InvalidSigner();
    error SignatureExpired(uint256 signatureDeadline);
}

/// Forks Sepolia and drives the REAL Permit2, Circle USDC, Aztec testnet registry and Inbox through a freshly
/// deployed portal + router. Skips only when SEPOLIA_RPC_URL is unset; `bun run test:evm:fork` refuses to run
/// without it, so the gate can never pass on skipped tests. The pins below equal the deployer's network pins
/// (`networks.test.ts` asserts it) and the node info the testnet probe checks.
contract SepoliaForkTest is Test {
    address internal constant REGISTRY = 0xA0BFb1B494FB49041e5c6e8c2C1BE09cD171c6Ba;
    address internal constant INBOX = 0x816ce1861ec258F99279E75a3EE6B5Dfc9571E30;
    address internal constant OUTBOX = 0xb9daE0F8c5dD6524c1015fFE6494d9fD0623DF0d;
    uint256 internal constant ROLLUP_VERSION = 2_914_217_885;
    address internal constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    bytes32 internal constant L2_BRIDGE = bytes32(uint256(0xB41D6E));
    bytes32 internal constant RECIPIENT = bytes32(uint256(0x3333));
    bytes32 internal constant SECRET_HASH = bytes32(uint256(0x5555));
    uint256 internal constant AMOUNT = 5e6;

    // Not a well-known test key: famous ones carry EIP-7702 delegations on Sepolia, which turns Permit2's EOA check
    // into an `isValidSignature` call.
    uint256 internal userPk = 0x5EC12E7_A11CE_0BEEF_1B;
    address internal user;
    TokenPortal internal portal;
    Permit2DepositRouter internal router;

    function setUp() public {
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        user = vm.addr(userPk);
        require(user.code.length == 0, "signer must be a plain EOA on this fork");

        // The deploy order: the router names the portal before the portal's initialize checks that binding.
        portal = new TokenPortal();
        router = new Permit2DepositRouter(ISignatureTransfer(PERMIT2), ITokenPortal(address(portal)), IERC20(USDC));
        portal.initialize(REGISTRY, USDC, L2_BRIDGE, address(router));
        deal(USDC, user, 100e6);
        vm.prank(user);
        IERC20(USDC).approve(PERMIT2, type(uint256).max);
    }

    function test_portalBindsTheCanonicalRollup() public view {
        IRollup rollup = IRollup(address(IRegistry(REGISTRY).getCanonicalRollup()));
        assertEq(address(portal.rollup()), address(rollup), "rollup");
        assertEq(address(portal.inbox()), INBOX, "inbox");
        assertEq(address(portal.outbox()), OUTBOX, "outbox");
        assertEq(portal.rollupVersion(), ROLLUP_VERSION, "rollup version");
        assertEq(address(router.TOKEN()), USDC, "router token");
        assertEq(portal.router(), address(router), "portal router");
    }

    /// The digest this suite signs is Permit2's own: the domain derivation matches the live contract.
    function test_permit2DomainMatchesTheSpec() public view {
        assertEq(Permit2Digest.domainSeparator(block.chainid, PERMIT2), ISignatureTransfer(PERMIT2).DOMAIN_SEPARATOR());
    }

    function test_depositPublic_landsInTheRealInbox() public {
        uint256 inserted = IInbox(INBOX).getTotalMessagesInserted();
        bytes memory sig = _sign(RECIPIENT, false, 0, block.timestamp + 30 minutes);
        vm.recordLogs();
        vm.expectEmit(true, false, false, false, address(portal));
        emit TokenPortal.DepositToAztecPublic(user, 0, 0, 0, 0, 0);
        vm.prank(user);
        (bytes32 key, uint256 index) =
            router.deposit(AMOUNT, RECIPIENT, SECRET_HASH, false, 0, block.timestamp + 30 minutes, sig);

        assertEq(IERC20(USDC).balanceOf(user), 100e6 - AMOUNT, "user paid exactly");
        assertEq(IERC20(USDC).balanceOf(address(portal)), AMOUNT, "portal reserve");
        assertEq(IERC20(USDC).balanceOf(address(router)), 0, "router residue");
        assertEq(IInbox(INBOX).getTotalMessagesInserted(), inserted + 1, "one Inbox message");
        _assertInboxEmitted(key, index);
    }

    function test_depositPrivate_realPermit2() public {
        bytes memory sig = _sign(bytes32(0), true, 1, block.timestamp + 30 minutes);
        vm.prank(user);
        router.deposit(AMOUNT, bytes32(0), SECRET_HASH, true, 1, block.timestamp + 30 minutes, sig);
        assertEq(IERC20(USDC).balanceOf(address(portal)), AMOUNT, "portal reserve");
    }

    function test_nonceReplayReverts() public {
        uint256 deadline = block.timestamp + 30 minutes;
        bytes memory sig = _sign(RECIPIENT, false, 0, deadline);
        vm.prank(user);
        router.deposit(AMOUNT, RECIPIENT, SECRET_HASH, false, 0, deadline, sig);
        vm.prank(user);
        vm.expectRevert(IPermit2Errors.InvalidNonce.selector);
        router.deposit(AMOUNT, RECIPIENT, SECRET_HASH, false, 0, deadline, sig);
    }

    function test_expiredDeadlineReverts() public {
        uint256 deadline = block.timestamp - 1;
        bytes memory sig = _sign(RECIPIENT, false, 0, deadline);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(IPermit2Errors.SignatureExpired.selector, deadline));
        router.deposit(AMOUNT, RECIPIENT, SECRET_HASH, false, 0, deadline, sig);
    }

    /// Re-aiming the recipient after signing breaks the witness: no relayer can redirect a signed deposit. The
    /// refused attempt must not burn the nonce, so the user's genuine intent still goes through.
    function test_witnessTamperReverts_andKeepsTheNonce() public {
        uint256 deadline = block.timestamp + 30 minutes;
        bytes memory sig = _sign(RECIPIENT, false, 0, deadline);
        uint256 bitmap = ISignatureTransfer(PERMIT2).nonceBitmap(user, 0);
        vm.prank(user);
        vm.expectRevert(IPermit2Errors.InvalidSigner.selector);
        router.deposit(AMOUNT, bytes32(uint256(0xDEAD)), SECRET_HASH, false, 0, deadline, sig);
        assertEq(ISignatureTransfer(PERMIT2).nonceBitmap(user, 0), bitmap, "a refused permit consumed the nonce");

        vm.prank(user);
        router.deposit(AMOUNT, RECIPIENT, SECRET_HASH, false, 0, deadline, sig);
        assertEq(IERC20(USDC).balanceOf(address(portal)), AMOUNT);
    }

    /// The router passes `msg.sender` as Permit2's owner, so a stolen signature is useless to anyone else.
    function test_stolenSignatureIsUselessToOthers() public {
        uint256 deadline = block.timestamp + 30 minutes;
        bytes memory sig = _sign(RECIPIENT, false, 0, deadline);
        vm.prank(makeAddr("thief"));
        vm.expectRevert(IPermit2Errors.InvalidSigner.selector);
        router.deposit(AMOUNT, RECIPIENT, SECRET_HASH, false, 0, deadline, sig);
    }

    function _sign(bytes32 recipient, bool isPrivate, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = Permit2Digest.digest(
            Permit2Digest.Params({
                chainId: block.chainid,
                permit2: PERMIT2,
                token: USDC,
                amount: AMOUNT,
                spender: address(router),
                nonce: nonce,
                deadline: deadline,
                witness: router.hashWitness(recipient, SECRET_HASH, isPrivate),
                witnessTypeString: router.DEPOSIT_WITNESS_TYPE_STRING()
            })
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPk, digest);
        return abi.encodePacked(r, s, v);
    }

    /// The router returns the Inbox's own message hash and leaf index, and the message the real Inbox records runs
    /// from the portal to the bridge with a content that names the signer as depositor.
    function _assertInboxEmitted(bytes32 key, uint256 index) internal {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter != INBOX || logs[i].topics[0] != IInbox.MessageSent.selector) continue;
            assertEq(logs[i].topics[1], key, "key is the Inbox message hash");
            (,, DataStructures.L1ToL2Msg memory m) =
                abi.decode(logs[i].data, (bytes32, uint256, DataStructures.L1ToL2Msg));
            assertEq(m.index, index, "index is the Inbox leaf index");
            assertEq(m.sender.actor, address(portal), "sender is the portal");
            assertEq(m.recipient.actor, L2_BRIDGE, "recipient is the bridge");
            bytes memory preimage =
                abi.encodeWithSignature("mint_to_public(bytes32,uint256,address)", RECIPIENT, AMOUNT, user);
            assertEq(m.content, Hash.sha256ToField(preimage), "the content names the signer");
            assertEq(m.secretHash, SECRET_HASH, "secret hash");
            return;
        }
        assertTrue(false, "no MessageSent from the Inbox");
    }
}
