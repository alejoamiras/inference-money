// SPDX-License-Identifier: Apache-2.0
// Copyright 2024 Aztec Labs.
// Modified 2026 by the inference-money contributors. Derived from the canonical Aztec TokenPortal
// (aztec-packages l1-contracts/test/portals/TokenPortal.sol), with these changes:
//   - Deposit messages name their depositor: `mint_to_public(bytes32,uint256,address)` and
//     `mint_to_private(uint256,address)`. A direct deposit names `msg.sender`; the bound router's `...For` deposits
//     name the Permit2 signer it pulled from. `withdraw`'s message is the canonical one.
//   - `initialize` is deployer-only and init-once, and binds the router, which must name this portal and token. The
//     L2 bridge address is derived from this contract's address, so the binding cannot move into the constructor.
//   - Deposits cap `amount` at u128 (the L2 amount type), public deposits require `_to` to be a field element (an
//     Aztec address), and every deposit must raise the portal's balance by exactly `amount`.
//   - `withdraw` must lower the portal's balance by exactly `amount`.
//   - Deposits and `withdraw` are nonReentrant.
//   - `initialize` and `withdraw` emit events (`PortalInitialized`, `Withdraw`).
pragma solidity >=0.8.27;

import {IERC20} from "@oz/token/ERC20/IERC20.sol";
import {SafeERC20} from "@oz/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@oz/utils/ReentrancyGuardTransient.sol";

import {IRegistry} from "@aztec/governance/interfaces/IRegistry.sol";
import {IInbox} from "@aztec/core/interfaces/messagebridge/IInbox.sol";
import {IOutbox} from "@aztec/core/interfaces/messagebridge/IOutbox.sol";
import {IRollup} from "@aztec/core/interfaces/IRollup.sol";
import {Epoch} from "@aztec/core/libraries/TimeLib.sol";
import {DataStructures} from "@aztec/core/libraries/DataStructures.sol";
import {Hash} from "@aztec/core/libraries/crypto/Hash.sol";
import {Constants} from "@aztec/core/libraries/ConstantsGen.sol";

import {IDepositRouter} from "./interfaces/IDepositRouter.sol";
import {ITokenPortal} from "./interfaces/ITokenPortal.sol";

contract TokenPortal is ITokenPortal, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    error AlreadyInitialized();
    error NotInitializer();
    /// @notice The router names another portal or token, so its deposits would mint against the wrong reserve.
    error RouterMismatch();
    error NotRouter();
    /// @notice The L2 side holds amounts as u128; a larger deposit could never be claimed.
    error AmountExceedsL2Max();
    /// @notice An Aztec address is a field element, so neither a claim nor a return could ever name a larger `_to`.
    error RecipientExceedsFieldMax();
    /// @notice The token moved a different amount than requested (fee-on-transfer, surcharge, upgrade).
    error InexactTransfer();

    event DepositToAztecPublic(
        address indexed depositor, bytes32 to, uint256 amount, bytes32 secretHash, bytes32 key, uint256 index
    );

    event DepositToAztecPrivate(
        address indexed depositor, uint256 amount, bytes32 secretHashForL2MessageConsumption, bytes32 key, uint256 index
    );

    /// @notice The portal's whole binding, including the Outbox that is `withdraw`'s only authority.
    event PortalInitialized(
        address registry,
        address indexed underlying,
        bytes32 l2Bridge,
        address router,
        address rollup,
        address inbox,
        address outbox,
        uint256 rollupVersion
    );

    /// @notice `amount` is the reserve's debit and the message's amount, not what the recipient nets under a token fee.
    /// `callerOnL1` is the caller the message was hashed with: zero when anyone could execute it.
    event Withdraw(address indexed recipient, uint256 amount, address callerOnL1);

    IRegistry public registry;
    IERC20 public underlying;
    bytes32 public l2Bridge;
    /// @notice The one contract whose `...For` deposits may name a depositor other than itself.
    address public router;

    IRollup public rollup;
    IOutbox public outbox;
    IInbox public inbox;
    uint256 public rollupVersion;

    /// @notice The only address allowed to call `initialize`. Deploy and initialize are separate transactions, so
    /// without it a front-run of the first `initialize` could bind an attacker registry whose outbox drains the reserve.
    address public immutable initializer;

    constructor() {
        initializer = msg.sender;
    }

    /**
     * @notice Initialize the portal
     * @param _registry - The registry address
     * @param _underlying - The underlying token address
     * @param _l2Bridge - The L2 bridge address
     * @param _router - The deposit router, which must already name this portal and `_underlying`
     */
    function initialize(address _registry, address _underlying, bytes32 _l2Bridge, address _router) external {
        _requireInitializable();
        if (IDepositRouter(_router).PORTAL() != address(this) || IDepositRouter(_router).TOKEN() != _underlying) {
            revert RouterMismatch();
        }

        registry = IRegistry(_registry);
        underlying = IERC20(_underlying);
        l2Bridge = _l2Bridge;
        router = _router;

        rollup = IRollup(address(registry.getCanonicalRollup()));
        outbox = rollup.getOutbox();
        inbox = rollup.getInbox();
        rollupVersion = rollup.getVersion();

        emit PortalInitialized(
            _registry, _underlying, _l2Bridge, _router, address(rollup), address(inbox), address(outbox), rollupVersion
        );
    }

    /**
     * @notice Deposit funds into the portal and adds an L2 message which can only be consumed publicly on Aztec
     * @param _to - The aztec address of the recipient
     * @param _amount - The amount to deposit
     * @param _secretHash - The hash of the secret consumable message. The hash should be 254 bits (so it can fit in a
     * Field element)
     * @return The key of the entry in the Inbox and its leaf index
     */
    function depositToAztecPublic(bytes32 _to, uint256 _amount, bytes32 _secretHash)
        external
        nonReentrant
        returns (bytes32, uint256)
    {
        return _depositPublic(msg.sender, _to, _amount, _secretHash);
    }

    /// @notice `depositToAztecPublic` for the router, naming the signer it pulled the funds from as the depositor.
    function depositToAztecPublicFor(address _depositor, bytes32 _to, uint256 _amount, bytes32 _secretHash)
        external
        nonReentrant
        returns (bytes32, uint256)
    {
        _requireRouter();
        return _depositPublic(_depositor, _to, _amount, _secretHash);
    }

    /**
     * @notice Deposit funds into the portal and adds an L2 message which can only be consumed privately on Aztec
     * @param _amount - The amount to deposit
     * @param _secretHashForL2MessageConsumption - The hash of the secret consumable L1 to L2 message. The hash should be
     * 254 bits (so it can fit in a Field element)
     * @return The key of the entry in the Inbox and its leaf index
     */
    function depositToAztecPrivate(uint256 _amount, bytes32 _secretHashForL2MessageConsumption)
        external
        nonReentrant
        returns (bytes32, uint256)
    {
        return _depositPrivate(msg.sender, _amount, _secretHashForL2MessageConsumption);
    }

    /// @notice `depositToAztecPrivate` for the router, naming the signer it pulled the funds from as the depositor.
    function depositToAztecPrivateFor(address _depositor, uint256 _amount, bytes32 _secretHashForL2MessageConsumption)
        external
        nonReentrant
        returns (bytes32, uint256)
    {
        _requireRouter();
        return _depositPrivate(_depositor, _amount, _secretHashForL2MessageConsumption);
    }

    /**
     * @notice Withdraw funds from the portal
     * @dev Second part of withdraw, must be initiated from L2 first as it will consume a message from outbox
     * @param _recipient - The address to send the funds to
     * @param _amount - The amount to withdraw
     * @param _withCaller - Flag to use `msg.sender` as caller, otherwise address(0)
     * Must match the caller of the message (specified from L2) to consume it.
     * @param _epoch - The epoch the message is in
     * @param _numCheckpointsInEpoch - The number of checkpoints in that epoch
     * @param _leafIndex - The index of the message in the epoch's tree
     * @param _path - The sibling path of the message
     */
    function withdraw(
        address _recipient,
        uint256 _amount,
        bool _withCaller,
        Epoch _epoch,
        uint256 _numCheckpointsInEpoch,
        uint256 _leafIndex,
        bytes32[] calldata _path
    ) external nonReentrant {
        address callerOnL1 = _withCaller ? msg.sender : address(0);
        // The signature only tags the action so the hash is unique to it; nothing calls it.
        DataStructures.L2ToL1Msg memory message = DataStructures.L2ToL1Msg({
            sender: DataStructures.L2Actor(l2Bridge, rollupVersion),
            recipient: DataStructures.L1Actor(address(this), block.chainid),
            content: Hash.sha256ToField(
                abi.encodeWithSignature("withdraw(address,uint256,address)", _recipient, _amount, callerOnL1)
            )
        });

        outbox.consume(message, _epoch, _numCheckpointsInEpoch, _leafIndex, _path);

        // Checks the portal's debit, not the recipient's credit: the reserve is ours to protect, what the recipient
        // nets is the token's business. A transfer to the portal itself never debits, so it always reverts here.
        uint256 before = underlying.balanceOf(address(this));
        underlying.safeTransfer(_recipient, _amount);
        if (before - underlying.balanceOf(address(this)) != _amount) revert InexactTransfer();
        emit Withdraw(_recipient, _amount, callerOnL1);
    }

    function _depositPublic(address _depositor, bytes32 _to, uint256 _amount, bytes32 _secretHash)
        private
        returns (bytes32, uint256)
    {
        _requireDeposit(_amount);
        _requireRecipient(_to);

        DataStructures.L2Actor memory actor = DataStructures.L2Actor(l2Bridge, rollupVersion);
        // The signature only tags the action; nothing calls it.
        bytes32 contentHash = Hash.sha256ToField(
            abi.encodeWithSignature("mint_to_public(bytes32,uint256,address)", _to, _amount, _depositor)
        );

        _pullExact(_amount);
        (bytes32 key, uint256 index) = inbox.sendL2Message(actor, contentHash, _secretHash);
        emit DepositToAztecPublic(_depositor, _to, _amount, _secretHash, key, index);

        return (key, index);
    }

    function _depositPrivate(address _depositor, uint256 _amount, bytes32 _secretHash)
        private
        returns (bytes32, uint256)
    {
        _requireDeposit(_amount);

        DataStructures.L2Actor memory actor = DataStructures.L2Actor(l2Bridge, rollupVersion);
        // The signature only tags the action; nothing calls it.
        bytes32 contentHash =
            Hash.sha256ToField(abi.encodeWithSignature("mint_to_private(uint256,address)", _amount, _depositor));

        _pullExact(_amount);
        (bytes32 key, uint256 index) = inbox.sendL2Message(actor, contentHash, _secretHash);
        emit DepositToAztecPrivate(_depositor, _amount, _secretHash, key, index);

        return (key, index);
    }

    // The guards below are virtual only so the formal suite's canaries can delete one rule at a time and watch the
    // matching proof fail.

    function _requireInitializable() internal view virtual {
        if (msg.sender != initializer) revert NotInitializer();
        // `registry` is zero only before the first initialize, so a live portal can never be repointed.
        if (address(registry) != address(0)) revert AlreadyInitialized();
    }

    /// @dev Runs before any hashing or pull, so a stranger's `...For` call learns nothing and moves nothing.
    function _requireRouter() internal view virtual {
        if (msg.sender != router) revert NotRouter();
    }

    function _requireDeposit(uint256 _amount) internal pure virtual {
        if (_amount > type(uint128).max) revert AmountExceedsL2Max();
    }

    /// @dev The Inbox range-checks the content hash, never the fields hashed into it.
    function _requireRecipient(bytes32 _to) internal pure virtual {
        if (uint256(_to) > Constants.MAX_FIELD_VALUE) revert RecipientExceedsFieldMax();
    }

    /// @dev A short pull would mint more on L2 than the reserve holds (silent insolvency), so it reverts.
    function _pullExact(uint256 _amount) private {
        uint256 before = underlying.balanceOf(address(this));
        underlying.safeTransferFrom(msg.sender, address(this), _amount);
        if (underlying.balanceOf(address(this)) - before != _amount) revert InexactTransfer();
    }
}
