// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

import {ERC20} from "@oz/token/ERC20/ERC20.sol";

// Hostile and odd ERC-20 shapes the portal and router must survive. Every mint is permissionless: test-only.

contract PlainERC20 is ERC20 {
    constructor(string memory n, string memory s) ERC20(n, s) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// Skims `taxBps` of every transfer from the amount the recipient receives.
contract FeeOnTransferERC20 is PlainERC20 {
    uint256 public immutable taxBps;

    constructor(uint256 taxBps_) PlainERC20("Taxed", "TAX") {
        taxBps = taxBps_;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0)) {
            super._update(from, to, value);
        } else {
            uint256 fee = (value * taxBps) / 10_000;
            super._update(from, address(0xdead), fee);
            super._update(from, to, value - fee);
        }
    }
}

/// Charges the SENDER `surchargeBps` on top of every transfer: the recipient nets the full value, so only the
/// sender's own debit shows it.
contract SenderSurchargeERC20 is PlainERC20 {
    uint256 public immutable surchargeBps;

    constructor(uint256 surchargeBps_) PlainERC20("Surcharged", "SUR") {
        surchargeBps = surchargeBps_;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            super._update(from, address(0xdead), (value * surchargeBps) / 10_000);
        }
        super._update(from, to, value);
    }
}

/// Fires one armed call from inside a transfer that credits `trigger` (a transfer hook, as ERC-777 would), and
/// records how that inner call ended: `bytes4(0xffffffff)` for success, otherwise the revert selector.
contract HookERC20 is PlainERC20 {
    address public trigger;
    address public target;
    bytes public payload;
    bytes4 public innerResult;

    constructor() PlainERC20("Hooked", "HOOK") {}

    function arm(address trigger_, address target_, bytes calldata payload_) external {
        trigger = trigger_;
        target = target_;
        payload = payload_;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (from == address(0) || to != trigger || payload.length == 0) return;
        bytes memory call = payload;
        delete payload;
        (bool ok, bytes memory ret) = target.call(call);
        innerResult = ok ? bytes4(0xffffffff) : bytes4(ret);
    }
}

/// Circle-style blacklist: a blacklisted address can neither send nor receive.
contract BlacklistableERC20 is PlainERC20 {
    error Blacklisted(address account);

    mapping(address => bool) public blacklisted;

    constructor() PlainERC20("Listed", "LST") {}

    function setBlacklisted(address account, bool value) external {
        blacklisted[account] = value;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (blacklisted[from]) revert Blacklisted(from);
        if (blacklisted[to]) revert Blacklisted(to);
        super._update(from, to, value);
    }
}
