// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

import {IERC20} from "@oz/token/ERC20/IERC20.sol";
import {SafeERC20} from "@oz/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@oz/utils/ReentrancyGuard.sol";
import {ISignatureTransfer} from "./interfaces/ISignatureTransfer.sol";
import {ITokenPortal} from "./interfaces/ITokenPortal.sol";

/// @title Permit2DepositRouter
/// @notice One signature + one transaction deposit into a single, immutably bound `TokenPortal`. The Permit2 witness
/// binds the L2 intent (recipient, secret hash, public/private) to the signed transfer, and only the signer may
/// submit it, so a leaked signature cannot be redirected. Ownerless: no sweep, no setters.
contract Permit2DepositRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant DEPOSIT_WITNESS_TYPEHASH =
        keccak256("DepositWitness(bytes32 aztecRecipient,bytes32 secretHash,bool isPrivate)");
    /// @dev Permit2 appends this to its `PermitWitnessTransferFrom(...,` stub; referenced types sort alphabetically.
    string public constant DEPOSIT_WITNESS_TYPE_STRING =
        "DepositWitness witness)DepositWitness(bytes32 aztecRecipient,bytes32 secretHash,bool isPrivate)TokenPermissions(address token,uint256 amount)";

    ISignatureTransfer public immutable PERMIT2;
    ITokenPortal public immutable PORTAL;
    IERC20 public immutable TOKEN;

    error NotAContract();
    error PortalNotInitialized();
    error ZeroAmount();
    /// @dev The L2 side holds amounts as u128; a larger deposit could never be claimed.
    error AmountExceedsL2Max();
    /// @dev A private deposit's recipient is committed inside `secretHash`; naming one here would leak it.
    error PrivateDepositNamesRecipient();
    error PublicDepositNeedsRecipient();
    /// @dev The Permit2 pull delivered a different amount than signed (fee-on-transfer, upgrade).
    error InexactPull();
    /// @dev The portal left part of the deposit with the router.
    error ResidualBalance();

    event Deposit(
        address indexed depositor,
        bytes32 indexed aztecRecipient,
        bytes32 key,
        uint256 index,
        uint256 amount,
        bytes32 secretHash,
        bool isPrivate
    );

    /// @dev Reverts on an uninitialized portal: its `underlying` would bind the zero token forever.
    constructor(ISignatureTransfer permit2, ITokenPortal portal) {
        if (address(permit2).code.length == 0 || address(portal).code.length == 0) revert NotAContract();
        IERC20 token = portal.underlying();
        if (address(token) == address(0) || portal.l2Bridge() == bytes32(0)) revert PortalNotInitialized();
        PERMIT2 = permit2;
        PORTAL = portal;
        TOKEN = token;
    }

    /// @notice Pull `amount` of `TOKEN` from the caller via a Permit2 witness signature and deposit it to Aztec.
    /// @param aztecRecipient The L2 recipient for a public deposit; must be zero for a private one.
    /// @param secretHash The L1->L2 message secret hash. For a private deposit it also commits the recipient.
    /// @return key The Inbox message key.
    /// @return index The Inbox leaf index, needed to claim on L2.
    function deposit(
        uint256 amount,
        bytes32 aztecRecipient,
        bytes32 secretHash,
        bool isPrivate,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant returns (bytes32 key, uint256 index) {
        _checkIntent(amount, aztecRecipient, isPrivate);

        // Donations sitting in the router are never spent: the call must leave its balance exactly unchanged.
        uint256 before = TOKEN.balanceOf(address(this));
        PERMIT2.permitWitnessTransferFrom(
            ISignatureTransfer.PermitTransferFrom({
                permitted: ISignatureTransfer.TokenPermissions({token: address(TOKEN), amount: amount}),
                nonce: nonce,
                deadline: deadline
            }),
            ISignatureTransfer.SignatureTransferDetails({to: address(this), requestedAmount: amount}),
            msg.sender,
            hashWitness(aztecRecipient, secretHash, isPrivate),
            DEPOSIT_WITNESS_TYPE_STRING,
            signature
        );
        if (TOKEN.balanceOf(address(this)) - before != amount) revert InexactPull();

        TOKEN.forceApprove(address(PORTAL), amount);
        (key, index) = isPrivate
            ? PORTAL.depositToAztecPrivate(amount, secretHash)
            : PORTAL.depositToAztecPublic(aztecRecipient, amount, secretHash);
        TOKEN.forceApprove(address(PORTAL), 0);
        _checkSettled(before);

        emit Deposit(msg.sender, aztecRecipient, key, index, amount, secretHash, isPrivate);
    }

    /// @notice The EIP-712 struct hash of the witness the depositor signs.
    function hashWitness(bytes32 aztecRecipient, bytes32 secretHash, bool isPrivate) public pure returns (bytes32) {
        return keccak256(abi.encode(DEPOSIT_WITNESS_TYPEHASH, aztecRecipient, secretHash, isPrivate));
    }

    // The two guards below are virtual only so the formal suite's canaries can delete one rule at a time and
    // watch the matching proof fail.

    function _checkIntent(uint256 amount, bytes32 aztecRecipient, bool isPrivate) internal pure virtual {
        if (amount == 0) revert ZeroAmount();
        if (amount > type(uint128).max) revert AmountExceedsL2Max();
        if (isPrivate && aztecRecipient != bytes32(0)) revert PrivateDepositNamesRecipient();
        if (!isPrivate && aztecRecipient == bytes32(0)) revert PublicDepositNeedsRecipient();
    }

    function _checkSettled(uint256 before) internal view virtual {
        if (TOKEN.balanceOf(address(this)) != before) revert ResidualBalance();
    }
}
