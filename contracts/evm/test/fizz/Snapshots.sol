// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

import {Base} from "./Base.sol";

/// @notice Used to take snapshots of the state before and after a function call
abstract contract Snapshots is Base {
    struct State {
        uint256 portalBal;
        uint256 routerBal;
        uint256 routerAllowance;
        uint256 inboxSent;
        uint256[3] actorBal;
        uint256 actorTokenBalance;
        uint256 depositMsgsLen;
        uint256 pendingLen;
        uint256 exitMsgsLen;
        uint256 provenUnpaidLen;
        uint256 paidLen;
        uint256 unprovenLen;
        uint256 gDeposited;
        uint256 gDepositCount;
        uint256 gWithdrawn;
        uint256 gWithdrawCount;
        uint256 gClaimed;
        uint256 gReturned;
        uint256 gExited;
        uint256 gPortalDonated;
        uint256 gRouterDonated;
        uint256 gNextEpoch;
        uint256 pendingDepositAmount;
    }

    State internal stateBefore;
    State internal stateAfter;

    /// Plain views on mocks the harness owns; none can revert.
    function _takeSnapshot(State storage state) private {
        state.portalBal = usdc.balanceOf(address(portal));
        state.routerBal = usdc.balanceOf(address(router));
        state.routerAllowance = usdc.allowance(address(router), address(portal));
        state.inboxSent = inbox.sent();
        for (uint256 i; i < 3; i++) {
            state.actorBal[i] = usdc.balanceOf(actors[i]);
        }
        state.actorTokenBalance = usdc.balanceOf(actor);
        state.depositMsgsLen = depositMsgs.length;
        state.pendingLen = pendingDeposits.length;
        state.exitMsgsLen = exitMsgs.length;
        state.provenUnpaidLen = provenUnpaidExits.length;
        state.paidLen = paidExits.length;
        state.unprovenLen = unprovenExits.length;
        state.gDeposited = ghosts.deposited;
        state.gDepositCount = ghosts.depositCount;
        state.gWithdrawn = ghosts.withdrawn;
        state.gWithdrawCount = ghosts.withdrawCount;
        state.gClaimed = ghosts.claimed;
        state.gReturned = ghosts.returned;
        state.gExited = ghosts.exited;
        state.gPortalDonated = ghosts.portalDonated;
        state.gRouterDonated = ghosts.routerDonated;
        state.gNextEpoch = nextEpoch;
        state.pendingDepositAmount = ghosts.pendingDepositAmount;
    }

    function snapshotBefore() internal {
        _takeSnapshot(stateBefore);
    }

    function snapshotAfter() internal {
        _takeSnapshot(stateAfter);
    }
}
