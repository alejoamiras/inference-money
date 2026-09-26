// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

import {Test, Vm} from "forge-std/Test.sol";
import {IERC20} from "@oz/token/ERC20/IERC20.sol";
import {IRegistry} from "@aztec/governance/interfaces/IRegistry.sol";
import {IRollup} from "@aztec/core/interfaces/IRollup.sol";
import {IInbox} from "@aztec/core/interfaces/messagebridge/IInbox.sol";

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
/// without it, so the gate can never pass on skipped tests. The pins below equal the deployer's network pins and
/// the node info the testnet probe checks.
contract SepoliaForkTest is Test {
    address internal constant REGISTRY = 0xA0BFb1B494FB49041e5c6e8c2C1BE09cD171c6Ba;
    address internal constant INBOX = 0x3047dBF2b7dd9f58AC41113525480F94745a4f7C;
    address internal constant OUTBOX = 0x905f80009bBef9d9426675B45009922971eD42fF;
    uint256 internal constant ROLLUP_VERSION = 1_821_665_230;
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

        portal = new TokenPortal();
        portal.initialize(REGISTRY, USDC, L2_BRIDGE);
        router = new Permit2DepositRouter(ISignatureTransfer(PERMIT2), ITokenPortal(address(portal)));
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
    }

    /// The digest this suite signs is Permit2's own: the domain derivation matches the live contract.
    function test_permit2DomainMatchesTheSpec() public view {
        assertEq(Permit2Digest.domainSeparator(block.chainid, PERMIT2), ISignatureTransfer(PERMIT2).DOMAIN_SEPARATOR());
    }

    function test_depositPublic_landsInTheRealInbox() public {
        uint256 inserted = IInbox(INBOX).getTotalMessagesInserted();
        bytes memory sig = _sign(RECIPIENT, false, 0, block.timestamp + 30 minutes);
        vm.recordLogs();
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

    /// The router returns the Inbox's own message hash and leaf index, as recorded in its `MessageSent` event.
    function _assertInboxEmitted(bytes32 key, uint256 index) internal {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sent = IInbox.MessageSent.selector;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter != INBOX || logs[i].topics[0] != sent) continue;
            assertEq(logs[i].topics[2], key, "key is the Inbox message hash");
            (uint256 emittedIndex,) = abi.decode(logs[i].data, (uint256, bytes16));
            assertEq(emittedIndex, index, "index is the Inbox leaf index");
            return;
        }
        assertTrue(false, "no MessageSent from the Inbox");
    }
}
