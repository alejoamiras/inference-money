// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

import {ECDSA} from "@oz/utils/cryptography/ECDSA.sol";

bytes4 constant ERC1271_MAGIC = 0x1626ba7e;

/// A Safe-style contract wallet: valid iff its owner's key signed the hash.
contract HonestWallet {
    address public immutable owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        (address signer,,) = ECDSA.tryRecoverCalldata(hash, signature);
        return signer == owner ? ERC1271_MAGIC : bytes4(0xffffffff);
    }
}

/// A wallet (or 7702 delegate) that approves every signature.
contract PermissiveWallet {
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        return ERC1271_MAGIC;
    }
}

/// A 7702 delegate that answers ERC-1271 honestly: valid iff the delegating account's own key signed.
contract Honest1271Delegate {
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        (address signer,,) = ECDSA.tryRecoverCalldata(hash, signature);
        return signer == address(this) ? ERC1271_MAGIC : bytes4(0xffffffff);
    }
}

contract WrongMagicDelegate {
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        return 0xdeadbeef;
    }
}

contract RevertingDelegate {
    error NoSignatures();

    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        revert NoSignatures();
    }
}

/// A delegate with no ERC-1271 at all.
contract Inert {}
