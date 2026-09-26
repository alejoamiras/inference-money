// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

import {Test} from "forge-std/Test.sol";
import {Permit2DepositRouter} from "../src/Permit2DepositRouter.sol";
import {ISignatureTransfer} from "../src/interfaces/ISignatureTransfer.sol";
import {ITokenPortal} from "../src/interfaces/ITokenPortal.sol";
import {MockPermit2} from "./mocks/MockPermit2.sol";
import {MockTokenPortal} from "./mocks/MockPortal.sol";
import {MockUsdc} from "./mocks/MockUsdc.sol";
import {Permit2Digest} from "./mocks/Permit2Digest.sol";

/// The L1 analogue of the content-hash keystone. bridge-core signs the Permit2 typed data and this router re-derives
/// the witness; if the two disagree, every signature fails. The literals below were computed independently with
/// `cast` and are pinned by bridge-core against the same inputs. Agreeing on one literal can still hide a shared
/// mistake, so every signed input is also mutated one at a time and must move the digest.
contract WitnessHashTest is Test {
    bytes32 internal constant TYPEHASH = 0x5676d1bb485b72587e53291dacdbc15a10cc4eedbfd053b48bdad670cfd28e76;
    bytes32 internal constant TYPE_STRING_HASH = 0x7676bad7bdab484f01c8f07a6199e1c55762df6df24353283ebf3becb1a1ce71;
    bytes32 internal constant WITNESS_PUBLIC = 0xf0c082e1a17894595ba224fea1dba89d9049398a98100c74ad85b4f0a3daa037;
    bytes32 internal constant WITNESS_PRIVATE = 0x5b14eb81e077a6bd008a7df9f4dfce6cad8ec55bddfb64cc42da98179685fbaa;
    bytes32 internal constant SEPOLIA_PERMIT2_DOMAIN =
        0x94c1dec87927751697bfc9ebf6fc4ca506bed30308b518f0e9d6c5f74bbafdb8;
    bytes32 internal constant DIGEST_PUBLIC = 0x17ea9ea7bf5e727ebf675ad104f7c747c08bde28d6bc0e36e1d466a6b3d254e2;

    bytes32 internal constant RECIPIENT = bytes32(uint256(0x1234));
    bytes32 internal constant SECRET_HASH = bytes32(uint256(0x5EC7E7));
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    Permit2DepositRouter internal router;

    function setUp() public {
        router = new Permit2DepositRouter(
            ISignatureTransfer(address(new MockPermit2())), ITokenPortal(address(new MockTokenPortal(new MockUsdc())))
        );
    }

    function test_typeDefinitionsPinned() public pure {
        assertEq(
            keccak256("DepositWitness(bytes32 aztecRecipient,bytes32 secretHash,bool isPrivate)"), TYPEHASH, "typehash"
        );
    }

    function test_routerTypeDefinitionsPinned() public view {
        assertEq(router.DEPOSIT_WITNESS_TYPEHASH(), TYPEHASH, "router typehash");
        assertEq(keccak256(bytes(router.DEPOSIT_WITNESS_TYPE_STRING())), TYPE_STRING_HASH, "router type string");
    }

    function test_witnessVectorsPinned() public view {
        assertEq(router.hashWitness(RECIPIENT, SECRET_HASH, false), WITNESS_PUBLIC, "public witness");
        assertEq(router.hashWitness(bytes32(0), SECRET_HASH, true), WITNESS_PRIVATE, "private witness");
    }

    function test_digestVectorPinned() public view {
        assertEq(Permit2Digest.domainSeparator(11_155_111, PERMIT2), SEPOLIA_PERMIT2_DOMAIN, "domain separator");
        assertEq(Permit2Digest.digest(_base()), DIGEST_PUBLIC, "digest");
    }

    function test_everySignedInputMovesTheDigest() public view {
        for (uint256 i = 0; i < 10; i++) {
            Permit2Digest.Params memory p = _base();
            if (i == 0) p.chainId = 1;
            else if (i == 1) p.permit2 = address(0xBEEF);
            else if (i == 2) p.token = address(0xBEEF);
            else if (i == 3) p.amount += 1;
            else if (i == 4) p.spender = address(0xBEEF);
            else if (i == 5) p.nonce += 1;
            else if (i == 6) p.deadline += 1;
            else if (i == 7) p.witness = router.hashWitness(bytes32(uint256(0xBEEF)), SECRET_HASH, false);
            else if (i == 8) p.witness = router.hashWitness(RECIPIENT, bytes32(uint256(0xBEEF)), false);
            else p.witness = router.hashWitness(RECIPIENT, SECRET_HASH, true);
            assertNotEq(
                Permit2Digest.digest(p), DIGEST_PUBLIC, string.concat("input ", vm.toString(i), " does not bind")
            );
        }
    }

    function _base() internal view returns (Permit2Digest.Params memory) {
        return Permit2Digest.Params({
            chainId: 11_155_111,
            permit2: PERMIT2,
            token: USDC,
            amount: 1_000_000,
            spender: address(0xA0),
            nonce: 7,
            deadline: 1_800_000_000,
            witness: router.hashWitness(RECIPIENT, SECRET_HASH, false),
            witnessTypeString: router.DEPOSIT_WITNESS_TYPE_STRING()
        });
    }
}
