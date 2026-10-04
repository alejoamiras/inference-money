// SPDX-License-Identifier: MIT
pragma solidity >=0.8.27 <0.9.0;

import "../Base.sol";
import {RoundTripHandler} from "./RoundTripHandler.sol";

/// @notice Inherits from all the handlers to expose all entry points in a single contract.
///         Manages environment changes (e.g. current actor, current token, mocks setup, etc.).
///         `RoundTripHandler` inherits the AztecL2, Permit2DepositRouter and TokenPortal handlers.
abstract contract Handlers is RoundTripHandler {
    function setCurrentActor(uint256 entropy) public {
        actor = actors[entropy % actors.length];
    }
}
