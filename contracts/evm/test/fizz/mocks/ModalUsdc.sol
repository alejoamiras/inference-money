// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

import {ReentrancyGuardTransient} from "@oz/utils/ReentrancyGuardTransient.sol";
import {MockUsdc} from "../../mocks/MockUsdc.sol";

/// The project's `MockUsdc` (6 decimals, permissionless mint) with the behaviours a USDC upgrade or Circle itself
/// could switch on mid-life: a recipient-side fee, a sender-side surcharge, a blacklist, and one armed callback (an
/// ERC-777-style hook) on the first transfer that touches `hookTrigger` and is made by `hookCaller`. In `Normal` mode
/// with nothing armed or listed it is `MockUsdc`.
contract ModalUsdc is MockUsdc {
    enum Mode {
        Normal,
        FeeOnTransfer,
        SenderSurcharge
    }

    error Blacklisted(address account);

    uint256 public constant BPS = 100; // 1%
    address public constant SINK = address(0xdead);

    Mode public mode;
    mapping(address => bool) public blacklisted;

    address public hookTrigger;
    /// The token's caller that must make the triggering transfer. Arming with a contract that transfers only inside
    /// its own `nonReentrant` calls makes the guard the one thing that can refuse the callback.
    address public hookCaller;
    address public hookTarget;
    bytes public hookPayload;
    uint256 public hookFired;
    /// Callbacks not refused with `ReentrancyGuardReentrantCall`: a success, or a revert some other check raised
    /// before the guard could.
    uint256 public hookReentrySucceeded;

    function setMode(Mode m) external {
        mode = m;
    }

    function setBlacklisted(address account, bool value) external {
        blacklisted[account] = value;
    }

    function arm(address trigger, address caller, address target, bytes calldata payload) external {
        hookTrigger = trigger;
        hookCaller = caller;
        hookTarget = target;
        hookPayload = payload;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (blacklisted[from]) revert Blacklisted(from);
        if (blacklisted[to]) revert Blacklisted(to);

        if (from == address(0) || to == address(0) || mode == Mode.Normal) {
            super._update(from, to, value);
        } else if (mode == Mode.FeeOnTransfer) {
            uint256 fee = (value * BPS) / 10_000;
            super._update(from, SINK, fee);
            super._update(from, to, value - fee);
        } else {
            super._update(from, SINK, (value * BPS) / 10_000);
            super._update(from, to, value);
        }

        if (from == address(0) || hookPayload.length == 0 || msg.sender != hookCaller) return;
        if (to != hookTrigger && from != hookTrigger) return;
        bytes memory call = hookPayload;
        delete hookPayload;
        hookFired++;
        (bool ok, bytes memory reason) = hookTarget.call(call);
        // Cutting the revert data to its selector is the point.
        // forge-lint: disable-next-line(unsafe-typecast)
        if (ok || bytes4(reason) != ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector) {
            hookReentrySucceeded++;
        }
    }
}
