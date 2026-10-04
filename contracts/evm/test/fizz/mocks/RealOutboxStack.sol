// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

import {Outbox} from "@aztec/core/messagebridge/Outbox.sol";
import {FakeRollup} from "../../mocks/AztecFakes.sol";

/// Aztec's REAL Outbox (membership proof + per-epoch nullifier) behind the project's `FakeRollup`. The two name each
/// other in their constructors; a fresh deployer creates at nonces 1 and 2, so the rollup's address is known before
/// the Outbox is built, with no cheatcode a fuzzer might lack.
contract RealOutboxStack {
    Outbox public immutable outbox;
    FakeRollup public immutable rollup;

    constructor(address inbox) {
        address predictedRollup = address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xd6), bytes1(0x94), address(this), bytes1(0x02)))))
        );
        outbox = new Outbox(predictedRollup, 4242);
        rollup = new FakeRollup(inbox, address(outbox));
        require(address(rollup) == predictedRollup, "rollup address prediction");
        require(rollup.VERSION() == 4242, "fake rollup version");
    }
}
