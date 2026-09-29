# Phase 4 — `bridge-core`

Status: **green 2026-09-26** (gate evidence below).

## Gate evidence

`bun run lint && bun run typecheck && bun test packages/bridge-core` → exit 0 (after `forge build`, which the package's `test` script runs first): 99 tests across 16 files, 246 assertions; all four workspace typechecks exit 0. `bun run lint:actions` is also clean with the new workflow.

- **Cross-toolchain literals**: `content-hash.test.ts` asserts the three keystone hashes `ContentHash.t.sol` and the Noir keystone assert; `claim-secret.test.ts` asserts the domain separator and vectors of the Noir derivation; `permit2.test.ts` asserts `WitnessHash.t.sol`'s typehash, both witness hashes, the Sepolia Permit2 domain and the full digest, plus 10 mutation tests.
- **ABI pins** read forge `out/` and `@aztec/l1-artifacts` inside `it()`, with a drift canary. **Class-id pins** reproduce the Phase 3 ids and aztec-standards 5.0.1's Token id.

## What was built

- Copied from V1 with comment scrubs: `content-hash`, `claim-secret`, `l1-receipt`, `progress`, `status` + tests.
- `permit2.ts`, `deposit.ts` (prepare/submit/confirm/reconcile), `manifest.ts` (zod strict, one shared deployer), `network.ts`, `errors.ts`, `artifacts.ts`, `abi.ts`, `outbox.ts` (a viem `getRoots` reader, so no second viem via `@aztec/ethereum`).
- `claim.ts`: `waitClaimable` (checkpoint, then a simulation from the claimer's wallet) and `claim` (sponsored private claims, `wallet-default` only by explicit choice, "already-consumed", `SponsorUnavailableError`).
- `exit.ts`: `exitToL1` locates **its** message by content in the mined tx effect (exactly one match, else reject), and `exitTicketFromTx` resumes from (tx hash, recipient, amount), choosing the first unconsumed identical occurrence.
- `withdraw.ts`: `buildWithdrawProof` (pending / bounded rebuild on a root mismatch), `waitWithdrawable` (60 min default), `withdrawOnL1` (simulate, then write; `AlreadyWithdrawnError`, `StaleProofError`), and `finishWithdrawal` (rebuilds a stale proof at most 3 times).
- `fees.ts`: `predictedWorstMinFees`.
- Test doubles: `test/fake-wallet.ts` (the four wallet methods aztec.js interactions reach; records calls, fee payer and auth witnesses) and `test/fake-epoch.ts` (one epoch served through the node and Outbox calls the **real** stdlib witness helper makes, with scripted proven / unproven / mismatched roots).
- CI `bridge-core.yml` (changes filter includes `contracts/evm/**` and the committed L2 artifacts; installs foundry, so the ABI pins never skip) and its `docs/ci-pipeline.md` row.

## Decisions and deviations

1. **V1's `l2.ts` is folded into `claim.ts` and `exit.ts`.** Its wrappers were one-per-flow; splitting by flow keeps each module testable in isolation, and nothing else imported them.
2. **`exitToL1` takes the node.** It must read the mined tx effect to find the message index. V1 assumed `l2ToL1Msgs[0]` (plan finding 12), which is wrong as soon as a tx emits any other message.
3. **The router is a refused exit recipient**, alongside zero and the portal. It is ownerless with no sweep, so USDC withdrawn to it is lost.
4. **`DepositDraft` has no separate `permit` field.** The plan's sketch had `permit: { nonce, deadline }`. The draft keeps the full `typedData` (its message carries both) and the `witness`, so the signed payload and the calldata come from one object.
5. **`fees.ts` holds only `predictedWorstMinFees`.** The deployer already owns the Fee Juice bridge (D24) and the budget. V1's claim-in-tx and pre-existing Fee Juice payment helpers served the fuel and mainnet paths, both out of scope.
6. **`finishWithdrawal` is new.** The plan puts a bounded rebuild both in witness construction (a root mismatch) and at simulation (a stale-proof revert). One function composes them, so a caller cannot forget the second bound.
7. **Stale-proof reverts** are `MerkleLib__InvalidRoot`, `MerkleLib__InvalidIndexForPathLength`, `Outbox__NothingToConsumeAtEpoch`, `Outbox__InvalidNumCheckpointsInEpoch` and `Outbox__LeafIndexOutOfBounds`. `Outbox__AlreadyNullified` alone means "withdrawn". Any other revert propagates unchanged.

## Attempts and fixes

- `it.each` rows are evaluated at collection time, before `beforeAll`. A row holding a value set in `beforeAll` saw `undefined`. Fix: the rows are thunks.
- A viem `ContractFunctionExecutionError` built without `args` throws inside its own message formatter. The test double passes `args: []`.
- Un-awaited `expect(p).rejects` assertions in the new claim tests would have passed vacuously. They are all awaited now, and every `.rejects` in the package was re-checked.
- `waitClaimable` exceeded the cognitive-complexity budget (18 > 15). The per-attempt probe moved into `probeClaimable`.
