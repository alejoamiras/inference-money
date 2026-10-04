Fuzz profile: via_ir required (stack too deep), optimizer_runs=0 — coverage deflated ~10%, targets adjusted

Build command (`{FUZZ_BUILD_CMD}`): `cd contracts/evm && FOUNDRY_PROFILE=fuzz forge build`

`setup_fuzz_profile.sh`: attempt 1 (`via_ir = false`) failed with "Stack too deep" (the same failure a plain `forge coverage` hits); attempt 2 (`via_ir = true`, optimizer off) compiled → `FUZZ_PROFILE=ir-no-opt`. The project's default profile already leaves the optimizer off, so the fuzz build equals the default build.

## Per-contract targets (ir-no-opt column)

| Contract | Role | Target | Notes |
|---|---|---|---|
| TokenPortal | Core protocol logic (escrow, message send/consume) | 70% | |
| Permit2DepositRouter | Peripheral helper (router) | 40% | Aim higher: it is the main deposit path |
| interfaces/* | Interfaces | n/a | No executable lines |

## Cycle 0 — 2026-10-02T23:40Z (setup failure, not counted)

Medusa refused to deploy `FuzzTester`: the template's `targetContractsBalances` (2^192−1 wei) exceeds the deployer's 2^128−1. Set to `0xffffffffffffffffffffffff` (2^96−1, ample for 3 × 1000 ETH actors). Also: `workers` 10 → 6 (shared machine), `slither.enabled` false (slither not installed).

## Cycle 1 — 2026-10-02T23:47Z

500,000 calls (test limit) in 2m00s, 12,955 branches, corpus 142, 0 failures.

| Contract | Role | Target | Hit | Status |
|---|---|---|---|---|
| TokenPortal | Core | 70% | 1.7% (1/60) | ❌ |
| Permit2DepositRouter | Peripheral | 40% | 0% (0/37) | ❌ |

Diagnosis: attribution failure, not reachability. Harness files are fully exercised (Base 109/111, TokenPortalHandler 99/113, AztecL2Handler 87/88, router handler 38/40 — the only misses are the violation-counter increments), but every contract with `immutable`s (TokenPortal, Router, the real Outbox, FakeRollup) shows 0. The project sets `bytecode_hash = "none"`, so Medusa cannot match runtime bytecode (immutables patched in) to its artifact. Fix: `bytecode_hash = "ipfs"` inside fizz's `[profile.fuzz]` block only.

## Cycle 2 — 2026-10-02T23:53Z

500,000 calls (test limit) in ~2m, 0 failures; `bytecode_hash = "ipfs"` in `[profile.fuzz]`.

| Contract | Role | Target | Hit | Status |
|---|---|---|---|---|
| TokenPortal | Core | 70% | 85.0% (51/60) | ✅ |
| Permit2DepositRouter | Peripheral | 40% | 97.3% (36/37) | ✅ |

Every executable line in both contracts is hit, including all revert branches (`NotInitializer`, `AlreadyInitialized`, `RouterMismatch`, `NotRouter`, `AmountExceedsL2Max`, `RecipientExceedsFieldMax`, both `InexactTransfer`s, `NotAContract`, `ZeroAmount`, `PrivateDepositNamesRecipient`, `PublicDepositNeedsRecipient`, `InexactPull`, `ResidualBalance`). The only unhit lines are the declarations of auto-generated public getters (`registry`, `underlying`, `l2Bridge`, `router`, `rollup`, `outbox`, `inbox`, `rollupVersion`, `initializer`, `PERMIT2`), which no handler calls. Skip justification: getters are views with no logic.

All targets met after cycle 2; proceeding to Step 9. (Medusa 1.5.1 prints `branches:`, not `branches hit:`, so `run_medusa.js`'s plateau detector never fires; each run ends at the 500k `testLimit` (~2 min).)

Coverage report: `fizz_data/corpus_medusa/coverage/coverage_report.html`

## Step 10 campaign (with all 53 properties) — 2026-10-03

Run 1: 2 failures (`property_l2LiabilitiesFitU128`, and an SP-08 assertion inside `tokenPortal_withdraw_tampered`). The second was a harness false positive: two identical withdraw messages (same recipient, amount and caller) proven as sibling leaves make a moved leaf index a genuine payout of the sibling. Fixed by skipping a tamper whose altered tuple is itself a proven, unpaid modelled exit (`_isProvenUnpaid`); regression `test_harness_tamperSkipsIdenticalSibling`. Run 1 results archived outside the repo; `test_results/` cleared before the rerun.

Run 2 (final): 500,522 calls in 5m15s, 19,266 branches, corpus 249, 65 tests passed, 1 failed (`property_l2LiabilitiesFitU128`, GL-26, EXPLORATORY; repro `test_repro_property_l2LiabilitiesFitU128`).

| Contract | Role | Target | Hit | Status |
|---|---|---|---|---|
| TokenPortal | Core | 70% | 100% (60/60) | ✅ |
| Permit2DepositRouter | Peripheral | 40% | 100% (37/37) | ✅ |

(The global properties now call the public getters, so the getter declarations count as hit too.)
