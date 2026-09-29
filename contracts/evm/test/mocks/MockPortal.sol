// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

import {IERC20} from "@oz/token/ERC20/IERC20.sol";
import {SafeERC20} from "@oz/token/ERC20/utils/SafeERC20.sol";
import {ITokenPortal} from "../../src/interfaces/ITokenPortal.sol";

/// A non-hashing stand-in for `TokenPortal`: it pulls the deposit and records it. The symbolic suites need it
/// because halmos 0.3.3 cannot model the sha256 precompile the real portal hashes with. `shortBy` makes it pull
/// less than asked, the misbehavior the router's settle check exists for.
contract MockTokenPortal is ITokenPortal {
    bytes32 public constant L2_BRIDGE = bytes32(uint256(0xB41D6E));

    IERC20 public immutable token;
    uint256 public shortBy;
    uint256 public calls;
    uint256 public lastAmount;
    bytes32 public lastTo;
    bytes32 public lastSecretHash;
    bool public lastPrivate;

    constructor(IERC20 token_) {
        token = token_;
    }

    function setShortBy(uint256 v) external {
        shortBy = v;
    }

    function underlying() external view returns (IERC20) {
        return token;
    }

    function l2Bridge() external pure returns (bytes32) {
        return L2_BRIDGE;
    }

    function depositToAztecPublic(bytes32 _to, uint256 _amount, bytes32 _secretHash)
        external
        returns (bytes32, uint256)
    {
        _record(_to, _amount, _secretHash, false);
        return (bytes32(uint256(0xABCD)), calls - 1);
    }

    function depositToAztecPrivate(uint256 _amount, bytes32 _secretHash) external returns (bytes32, uint256) {
        _record(bytes32(0), _amount, _secretHash, true);
        return (bytes32(uint256(0x9012)), calls - 1);
    }

    function _record(bytes32 to, uint256 amount, bytes32 secretHash, bool isPrivate) private {
        SafeERC20.safeTransferFrom(token, msg.sender, address(this), amount - shortBy);
        lastTo = to;
        lastAmount = amount;
        lastSecretHash = secretHash;
        lastPrivate = isPrivate;
        calls++;
    }
}

/// A portal that was deployed but never initialized: the router must refuse to bind to it.
contract UninitializedPortal {
    function underlying() external pure returns (IERC20) {
        return IERC20(address(0));
    }

    function l2Bridge() external pure returns (bytes32) {
        return bytes32(0);
    }
}
