// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

import {MockUsdc} from "./mocks/MockUsdc.sol";
import {Permit2Digest} from "./mocks/Permit2Digest.sol";
import {RouterFixture} from "./mocks/RouterFixture.sol";

contract Permit2DepositRouterFuzzTest is RouterFixture {
    uint256 internal constant U128_MAX = type(uint128).max;

    function setUp() public {
        _deployStack(new MockUsdc());
    }

    /// Every signed input must bind: XOR-mutating exactly one changes the digest Permit2 verifies. Address inputs
    /// keep only their low 160 bits, so a delta set only in the high bits would be a silent non-mutation; it is
    /// masked out rather than allowed to pass falsely.
    function testFuzz_everySignedInputBinds(uint256 delta, uint8 whichRaw) public view {
        uint8 which = whichRaw % 10;
        Permit2Digest.Params memory p = _params(RECIPIENT, SECRET_HASH, false);
        bytes32 base = Permit2Digest.digest(p);
        if (which == 9) {
            p.witness = router.hashWitness(bytes32(0), SECRET_HASH, true);
        } else {
            vm.assume(delta != 0);
            if (which == 1 || which == 2 || which == 4) vm.assume(uint160(delta) != 0);
            if (which == 0) p.chainId ^= delta;
            else if (which == 1) p.permit2 = address(uint160(p.permit2) ^ uint160(delta));
            else if (which == 2) p.token = address(uint160(p.token) ^ uint160(delta));
            else if (which == 3) p.amount ^= delta;
            else if (which == 4) p.spender = address(uint160(p.spender) ^ uint160(delta));
            else if (which == 5) p.nonce ^= delta;
            else if (which == 6) p.deadline ^= delta;
            else if (which == 7) p.witness = router.hashWitness(RECIPIENT ^ bytes32(delta), SECRET_HASH, false);
            else p.witness = router.hashWitness(RECIPIENT, SECRET_HASH ^ bytes32(delta), false);
        }
        assertTrue(Permit2Digest.digest(p) != base, "a signed input does not bind");
    }

    /// The router's own `permitDigest` equals the independent model of Permit2's digest for every input, so the key it
    /// requires is exactly the one Permit2 checks.
    function testFuzz_permitDigestMatchesTheSpec(
        uint256 amount,
        bytes32 recipient,
        bytes32 secretHash,
        bool isPrivate,
        uint256 nonce,
        uint256 deadline
    ) public view {
        Permit2Digest.Params memory p = _params(recipient, secretHash, isPrivate);
        p.amount = amount;
        p.nonce = nonce;
        p.deadline = deadline;
        assertEq(
            router.permitDigest(amount, recipient, secretHash, isPrivate, nonce, deadline), Permit2Digest.digest(p)
        );
        assertEq(
            router.PERMIT_WITNESS_TYPEHASH(),
            keccak256(abi.encodePacked(Permit2Digest.STUB, router.DEPOSIT_WITNESS_TYPE_STRING()))
        );
    }

    /// Over the whole u128 domain, with any donation parked in the router: the portal receives exactly `amount`,
    /// the message carries the same amount, and the router keeps exactly the donation with zero allowance.
    function testFuzz_depositAccounting(uint256 amount, uint256 donation, bool isPrivate) public {
        amount = bound(amount, 1, U128_MAX);
        donation = bound(donation, 0, U128_MAX);
        MockUsdc(address(token)).mint(user, amount);
        MockUsdc(address(token)).mint(address(router), donation);
        assertEq(token.allowance(address(router), address(portal)), 0, "allowance before");

        _deposit(amount, isPrivate);

        assertEq(token.balanceOf(address(portal)), amount, "portal amount");
        assertEq(token.balanceOf(user), 0, "user paid exactly");
        assertTrue(isPrivate ? lastMintWasPrivate(amount) : lastMintWasPublic(RECIPIENT, amount), "message");
        assertEq(token.balanceOf(address(router)), donation, "router residue");
        assertEq(token.allowance(address(router), address(portal)), 0, "allowance after");
    }

    function _params(bytes32 recipient, bytes32 secretHash, bool isPrivate)
        internal
        view
        returns (Permit2Digest.Params memory)
    {
        return Permit2Digest.Params({
            chainId: block.chainid,
            permit2: address(permit2),
            token: address(token),
            amount: 1e6,
            spender: address(router),
            nonce: 0,
            deadline: 1,
            witness: router.hashWitness(recipient, secretHash, isPrivate),
            witnessTypeString: router.DEPOSIT_WITNESS_TYPE_STRING()
        });
    }
}
