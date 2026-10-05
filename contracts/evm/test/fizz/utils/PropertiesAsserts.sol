// SPDX-License-Identifier: Unlicense
pragma solidity >=0.6.2 <0.9.0;

import {StringUtils} from "./StringUtils.sol";

/// @author Modified from Crytic (https://github.com/crytic/properties/blob/main/contracts/util/PropertiesAsserts.sol)
/// Each helper emits its `Assert*Fail` event with both operands and `reason`, then fails through `assert(false)`, the
/// panic Medusa's assertion mode reports.
contract PropertiesAsserts is StringUtils {
    event AssertFail(string);
    event AssertEqFail(string);
    event AssertNeqFail(string);
    event AssertGteFail(string);
    event AssertGtFail(string);
    event AssertLteFail(string);
    event AssertLtFail(string);

    function t(bool b, string memory reason) internal {
        if (!b) {
            emit AssertFail(reason);
            assert(false);
        }
    }

    function eq(uint256 a, uint256 b, string memory reason) internal {
        if (a != b) {
            string memory aStr = toString(a);
            string memory bStr = toString(b);
            bytes memory assertMsg = abi.encodePacked("Invalid: ", aStr, "!=", bStr, ", reason: ", reason);
            emit AssertEqFail(string(assertMsg));
            assert(false);
        }
    }

    function eq(int256 a, int256 b, string memory reason) internal {
        if (a != b) {
            string memory aStr = toString(a);
            string memory bStr = toString(b);
            bytes memory assertMsg = abi.encodePacked("Invalid: ", aStr, "!=", bStr, ", reason: ", reason);
            emit AssertEqFail(string(assertMsg));
            assert(false);
        }
    }

    function neq(uint256 a, uint256 b, string memory reason) internal {
        if (a == b) {
            string memory aStr = toString(a);
            string memory bStr = toString(b);
            bytes memory assertMsg = abi.encodePacked("Invalid: ", aStr, "==", bStr, ", reason: ", reason);
            emit AssertNeqFail(string(assertMsg));
            assert(false);
        }
    }

    function neq(int256 a, int256 b, string memory reason) internal {
        if (a == b) {
            string memory aStr = toString(a);
            string memory bStr = toString(b);
            bytes memory assertMsg = abi.encodePacked("Invalid: ", aStr, "==", bStr, ", reason: ", reason);
            emit AssertNeqFail(string(assertMsg));
            assert(false);
        }
    }

    function gte(uint256 a, uint256 b, string memory reason) internal {
        if (!(a >= b)) {
            string memory aStr = toString(a);
            string memory bStr = toString(b);
            bytes memory assertMsg = abi.encodePacked("Invalid: ", aStr, "<", bStr, " failed, reason: ", reason);
            emit AssertGteFail(string(assertMsg));
            assert(false);
        }
    }

    function gte(int256 a, int256 b, string memory reason) internal {
        if (!(a >= b)) {
            string memory aStr = toString(a);
            string memory bStr = toString(b);
            bytes memory assertMsg = abi.encodePacked("Invalid: ", aStr, "<", bStr, " failed, reason: ", reason);
            emit AssertGteFail(string(assertMsg));
            assert(false);
        }
    }

    function gt(uint256 a, uint256 b, string memory reason) internal {
        if (!(a > b)) {
            string memory aStr = toString(a);
            string memory bStr = toString(b);
            bytes memory assertMsg = abi.encodePacked("Invalid: ", aStr, "<=", bStr, " failed, reason: ", reason);
            emit AssertGtFail(string(assertMsg));
            assert(false);
        }
    }

    function gt(int256 a, int256 b, string memory reason) internal {
        if (!(a > b)) {
            string memory aStr = toString(a);
            string memory bStr = toString(b);
            bytes memory assertMsg = abi.encodePacked("Invalid: ", aStr, "<=", bStr, " failed, reason: ", reason);
            emit AssertGtFail(string(assertMsg));
            assert(false);
        }
    }

    function lte(uint256 a, uint256 b, string memory reason) internal {
        if (!(a <= b)) {
            string memory aStr = toString(a);
            string memory bStr = toString(b);
            bytes memory assertMsg = abi.encodePacked("Invalid: ", aStr, ">", bStr, " failed, reason: ", reason);
            emit AssertLteFail(string(assertMsg));
            assert(false);
        }
    }

    function lte(int256 a, int256 b, string memory reason) internal {
        if (!(a <= b)) {
            string memory aStr = toString(a);
            string memory bStr = toString(b);
            bytes memory assertMsg = abi.encodePacked("Invalid: ", aStr, ">", bStr, " failed, reason: ", reason);
            emit AssertLteFail(string(assertMsg));
            assert(false);
        }
    }

    function lt(uint256 a, uint256 b, string memory reason) internal {
        if (!(a < b)) {
            string memory aStr = toString(a);
            string memory bStr = toString(b);
            bytes memory assertMsg = abi.encodePacked("Invalid: ", aStr, ">=", bStr, " failed, reason: ", reason);
            emit AssertLtFail(string(assertMsg));
            assert(false);
        }
    }

    function lt(int256 a, int256 b, string memory reason) internal {
        if (!(a < b)) {
            string memory aStr = toString(a);
            string memory bStr = toString(b);
            bytes memory assertMsg = abi.encodePacked("Invalid: ", aStr, ">=", bStr, " failed, reason: ", reason);
            emit AssertLtFail(string(assertMsg));
            assert(false);
        }
    }
}
