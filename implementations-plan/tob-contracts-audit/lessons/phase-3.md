# Phase 3: L1 test gaps (F-6) and the USDC docs (F-4)

## Tests added

- `TokenPortal.t.sol`: `test_deposits_returnTheInboxKeyAndIndex`, `test_deposit_rejectsOverDelivery`, `testFuzz_initialize_refusesAMismatchedRouter` (placed beside `test_initialize_refusesARouterBoundElsewhere`, whose fixture it shares, rather than in `PortalRoundtripFuzz.t.sol`, whose subject is content-hash roundtrips).
- `Permit2DepositRouter.t.sol`: `test_overDeliveryRefusedAtThePull`, `test_senderSurchargeCannotSpendDonations`.
- `test/mocks/TestTokens.sol`: `OverDeliveringERC20`.

## Kill proof

Tests and mock committed first (`dfcf2d8`); each surviving mutant then re-applied to `contracts/evm/src` (same text as the mewt mutant), only its new test run, and `src` restored from HEAD.

```
killed 315 by test_deposits_returnTheInboxKeyAndIndex: [FAIL: public index: 0 != 2]
killed 317 by test_deposits_returnTheInboxKeyAndIndex: [FAIL: private index: 0 != 1]
killed 316 by test_deposits_returnTheInboxKeyAndIndex: [FAIL: private key: 0x00…00 != 0x698e…]
killed 204 by test_deposits_returnTheInboxKeyAndIndex: [FAIL: private key: 0x00…00 != 0x698e…]
killed 310 by test_deposit_rejectsOverDelivery: [FAIL: next call did not revert as expected]
killed 275 by testFuzz_initialize_refusesAMismatchedRouter: [FAIL: next call did not revert as expected; counterexample …]
killed 270 by testFuzz_initialize_refusesAMismatchedRouter: [FAIL: next call did not revert as expected; counterexample …]
killed 95 by test_overDeliveryRefusedAtThePull: [FAIL: Error != expected error: InexactTransfer() != InexactPull()]
killed 122 by test_senderSurchargeCannotSpendDonations: [FAIL: next call did not revert as expected]
restored: contracts/evm/src equals HEAD
```

95 shows why the router test pins the selector: under that mutant the portal's `InexactTransfer` fires instead.

## Equivalent survivors, not tested

| id | Mutation | Why equivalent |
|---|---|---|
| 81, 86, 91 | `code.length == 0` → `<= 0` (router constructor) | unsigned |
| 101 | `amount == 0` → `<= 0` | unsigned |
| 112 | `aztecRecipient != bytes32(0)` → `>` | a `bytes32` compares unsigned; nothing is below zero |
| 116 | `aztecRecipient == bytes32(0)` → `<=` | same |
| 292 | `address(registry) != address(0)` → `>` | an address compares unsigned |
| 30 | `forceApprove(PORTAL, 0)` deleted | the portal spends the exact finite approval, so it is already zero; `_assertRouterClean` asserts it (`Permit2DepositRouter.t.sol:182`) |

287 (`msg.sender != initializer` → `>`) survived forge in the audit and was caught by halmos's `proveInitializerOnly` on re-test.

## Notes

- `vm.expectRevert` applies to the next call, and a `new Contract(...)` evaluated inside the call's arguments is that next call: the first draft of the mismatch fuzz "did not revert" on run 0 for that reason. Construct first, then expect.
- perl prints locale warnings on this host unless `LC_ALL=C` is set; harmless.

## Gate

`git diff --quiet HEAD -- contracts` (exit 0), `bun run test:evm` (exit 0, 81 tests), `bun run test:evm:gas` (exit 0), `bun run test:evm:formal` (exit 0, "exactly the 11 expected proofs passed"), `bun run lint` (exit 0), `bun run typecheck` (exit 0), `bun run test` (exit 0). Passed 2026-10-03.
