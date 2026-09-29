// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

import {Test} from "forge-std/Test.sol";

/// Base for the formal suites: each halmos `check_` delegates to a public `prove*` body, so a forge canary can run that
/// exact body against a one-rule-deleted mutant and require it to fail on the assertion guarding that rule.
abstract contract ProofCanary is Test {
    /// Runs `proof` (an encoded call to one of this contract's `prove*` functions) and requires it to fail with a revert
    /// whose data carries `expected`, the message of the assertion the deleted rule should trip.
    function _assertProofFails(bytes memory proof, string memory expected) internal {
        (bool ok, bytes memory reason) = address(this).call(proof);
        assertFalse(ok, "the proof passed against its mutant");
        assertTrue(
            vm.indexOf(string(reason), expected) != type(uint256).max,
            string.concat("the proof failed on another assertion; wanted: ", expected)
        );
    }
}
