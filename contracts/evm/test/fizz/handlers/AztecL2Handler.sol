// SPDX-License-Identifier: MIT
pragma solidity >=0.8.27 <0.9.0;

import "../Base.sol";
import {Properties} from "../Properties.sol";

/// @notice The environment the portal lives in: the Aztec side reduced to its accounting (claims, returns, exits,
/// epoch proofs into the REAL Outbox), and the token / donation / re-entry conditions an adversary or a token
/// upgrade could impose. L2 rules (who may claim, merchant checks) are out of scope: any pending message may be
/// claimed or returned, any L2 balance may exit to any actor.
abstract contract AztecL2Handler is Properties {
    // ――――――――――――――――――――――――― L2 model ――――――――――――――――――――――――――

    /// `claim_public` / `claim_private`: consumes one pending deposit and mints it on L2. A private deposit's
    /// recipient is committed inside its secret, so the model picks one of the L2 accounts.
    function l2_claim(uint256 depositSeed, uint256 accountSeed) public {
        snapshotBefore();
        uint256 idx = _takePendingDeposit(depositSeed);
        if (idx == type(uint256).max) return;
        DepositMsg storage d = depositMsgs[idx];
        bytes32 recipient = d.isPrivate ? toL2Account(accountSeed) : d.to;
        l2Balance[recipient] += d.amount;
        if (!_isL2Account(recipient)) ghosts.l2OffAccount += d.amount;
        ghosts.claimed += d.amount;
        ghosts.l2Supply += d.amount;
        _closeL2Bracket();
    }

    /// `return_deposit_*`: consumes one pending deposit, mints nothing, and messages a withdraw to its depositor.
    function l2_returnDeposit(uint256 depositSeed) public {
        snapshotBefore();
        uint256 idx = _takePendingDeposit(depositSeed);
        if (idx == type(uint256).max) return;
        DepositMsg storage d = depositMsgs[idx];
        ghosts.returned += d.amount;
        _createExit(d.depositor, d.amount, address(0));
        _closeL2Bracket();
    }

    /// `exit_to_l1_*`: burns part of an L2 balance and messages a withdraw to an actor, optionally bound to a caller.
    function l2_exit(uint256 accountSeed, uint256 amount, address recipientSeed, bool withCaller, address callerSeed)
        public
    {
        bytes32 account = toL2Account(accountSeed);
        uint256 bal = l2Balance[account];
        if (bal == 0) return;
        amount = clampBetween(amount, 1, bal);
        snapshotBefore();
        _exit(account, amount, toActor(recipientSeed), withCaller ? toActor(callerSeed) : address(0));
        _closeL2Bracket();
    }

    /// Full-amount stress: the account's whole L2 balance leaves in one exit.
    function l2_exit_full(uint256 accountSeed, address recipientSeed) public {
        bytes32 account = toL2Account(accountSeed);
        uint256 bal = l2Balance[account];
        if (bal == 0) return;
        snapshotBefore();
        _exit(account, bal, toActor(recipientSeed), address(0));
        _closeL2Bracket();
    }

    /// The rollup proves an epoch: the oldest 1–4 unproven exits become a fresh epoch's tree (height 0, 1 or 2,
    /// zero-padded), inserted into the real Outbox at a random checkpoint count.
    function l2_proveEpoch(uint256 countSeed, uint256 checkpointsSeed) public {
        uint256 n = unprovenExits.length;
        if (n == 0) return;
        snapshotBefore();
        uint256 k = 1 + (countSeed % (n < MAX_LEAVES_PER_EPOCH ? n : MAX_LEAVES_PER_EPOCH));

        bytes32[4] memory leaves;
        for (uint256 i; i < k; i++) {
            ExitMsg storage e = exitMsgs[unprovenExits[i]];
            leaves[i] = _exitLeaf(e.recipient, e.amount, e.caller);
        }
        uint256 height = k == 1 ? 0 : (k == 2 ? 1 : 2);
        bytes32 p0 = _parent(leaves[0], leaves[1]);
        bytes32 p1 = _parent(leaves[2], leaves[3]);
        bytes32 root = height == 0 ? leaves[0] : (height == 1 ? p0 : _parent(p0, p1));

        uint256 epoch = nextEpoch++;
        uint256 numCheckpoints = 1 + (checkpointsSeed % MAX_CHECKPOINTS_PER_EPOCH);
        for (uint256 i; i < k; i++) {
            ExitMsg storage e = exitMsgs[unprovenExits[i]];
            e.proven = true;
            e.epoch = epoch;
            e.numCheckpoints = numCheckpoints;
            e.leafIndex = i;
            e.pathLen = height;
            if (height >= 1) e.path[0] = leaves[i ^ 1];
            if (height == 2) e.path[1] = i < 2 ? p1 : p0;
            provenUnpaidExits.push(unprovenExits[i]);
        }
        for (uint256 i = k; i < n; i++) {
            unprovenExits[i - k] = unprovenExits[i];
        }
        for (uint256 i; i < k; i++) {
            unprovenExits.pop();
        }

        // Hashed above: the prank must reach `insert`, not a sha256 precompile call.
        vm.prank(address(rollup));
        outbox.insert(Epoch.wrap(epoch), numCheckpoints, root);
        _closeL2Bracket();
    }

    // ―――――――――――――――――――――――― Environment ――――――――――――――――――――――――

    function env_secondary(uint8 selector, uint256 arg0, uint256 arg1, address arg2) public {
        selector = uint8(selector % 6);
        uint256 consumed = _noopBegin();
        if (selector == 0) _env_donatePortal(arg0);
        else if (selector == 1) _env_donateRouter(arg0);
        else if (selector == 2) _env_setTokenMode(arg0);
        else if (selector == 3) _env_setBlacklisted(arg2, arg0);
        else if (selector == 4) _env_armReentry(arg0, arg1);
        else _env_selfPayout(arg0, arg1);
        snapshotAfter();
        if (selector == 5) property_refusedCallIsNoop(consumed);
        _universalChecks(false, false);
    }

    function _env_donatePortal(uint256 amount) internal {
        amount = clampBetween(amount, 1, MAX_REALISTIC_AMOUNT);
        usdc.mint(address(portal), amount);
        ghosts.portalDonated += amount;
    }

    function _env_donateRouter(uint256 amount) internal {
        amount = clampBetween(amount, 1, MAX_REALISTIC_AMOUNT);
        usdc.mint(address(router), amount);
        ghosts.routerDonated += amount;
    }

    /// A USDC upgrade switching on a fee or a surcharge; Normal three times in four so flows keep running.
    function _env_setTokenMode(uint256 seed) internal {
        uint256 m = seed % 8;
        usdc.setMode(
            m == 6 ? ModalUsdc.Mode.FeeOnTransfer : (m == 7 ? ModalUsdc.Mode.SenderSurcharge : ModalUsdc.Mode.Normal)
        );
    }

    /// Circle blacklisting (one time in four) or clearing an actor.
    function _env_setBlacklisted(address who, uint256 seed) internal {
        usdc.setBlacklisted(toActor(who), seed % 4 == 0);
    }

    /// Arms one transfer hook that re-enters the portal (a deposit or a withdraw) or the router mid-transfer.
    function _env_armReentry(uint256 targetSeed, uint256 payloadSeed) internal {
        if (targetSeed % 2 == 0) {
            bytes memory payload = payloadSeed % 2 == 0
                ? abi.encodeCall(TokenPortal.depositToAztecPrivate, (1, bytes32(0)))
                : abi.encodeCall(TokenPortal.withdraw, (actors[0], 1, false, Epoch.wrap(0), 1, 0, new bytes32[](0)));
            usdc.arm(address(portal), address(portal), payload);
        } else {
            usdc.arm(
                address(router),
                address(router),
                abi.encodeCall(Permit2DepositRouter.deposit, (1, bytes32(0), bytes32(0), true, 0, 1, ""))
            );
        }
    }

    /// An L2 bug that let an exit name the portal itself as recipient: proven, it must still never pay out, because
    /// a self-transfer never debits the reserve.
    function _env_selfPayout(uint256 amount, uint256 checkpointsSeed) internal {
        amount = clampBetween(amount, 1, MAX_REALISTIC_AMOUNT);
        bytes32 root = _exitLeaf(address(portal), amount, address(0));
        uint256 epoch = nextEpoch++;
        uint256 numCheckpoints = 1 + (checkpointsSeed % MAX_CHECKPOINTS_PER_EPOCH);
        vm.prank(address(rollup));
        outbox.insert(Epoch.wrap(epoch), numCheckpoints, root);
        vm.prank(actor);
        try portal.withdraw(address(portal), amount, false, Epoch.wrap(epoch), numCheckpoints, 0, new bytes32[](0)) {
            ghosts.selfPayoutAccepted++;
        } catch {}
    }

    // ――――――――――――――――――――――――― Helpers ――――――――――――――――――――――――――

    function _closeL2Bracket() internal {
        snapshotAfter();
        _universalChecks(false, false);
    }

    function _isL2Account(bytes32 account) internal view returns (bool) {
        for (uint256 i; i < L2_ACCOUNTS.length; i++) {
            if (L2_ACCOUNTS[i] == account) return true;
        }
        return false;
    }

    function _exit(bytes32 account, uint256 amount, address recipient, address caller) internal {
        l2Balance[account] -= amount;
        ghosts.l2Supply -= amount;
        _createExit(recipient, amount, caller);
    }
}
