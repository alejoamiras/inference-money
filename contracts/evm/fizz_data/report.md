# Fuzzing Suite Report

## Suite Overview
- **Project**: inference-money, the L1 side of a USDC-only Ethereum-to-Aztec bridge (ownerless `TokenPortal` escrow plus `Permit2DepositRouter`). N/A for protocol-understanding.md; overview taken from `fizz_data/invariant-context.md`, `contracts.json` and `entry-point-selection.json`.
- **Suite location**: `test/fizz/` (metadata in `fizz_data/`)
- **Contracts targeted**: TokenPortal, Permit2DepositRouter
- **Total handlers**: 32 (29 primary, 3 secondary/dispatcher): TokenPortalHandler 15, Permit2DepositRouterHandler 5, AztecL2Handler 6 (L2 model: claim, return, exit, epoch proofs into the real Outbox), RoundTripHandler 6. The 3 dispatchers are `tokenPortal_secondary`, `permit2DepositRouter_secondary`, `env_secondary`.
- **Properties**: 53 (31 global, 22 function-specific)
- **Fuzzer**: Medusa 1.5.1 only. Echidna is not installed (`echidna.yaml` exists but is untested). Slither is not installed and is disabled.
- **Setup**: fizz-local mocks `ModalUsdc` (MockUsdc plus switchable fee-on-transfer, sender surcharge, blacklist and one armed re-entrant hook) and `RealOutboxStack` (Aztec's real Outbox behind FakeRollup). The rest reuse the project's RouterFixture, MockUsdc, MockPermit2, CapturingInbox, FakeRollup and FakeRegistry. Three actors, each seeded with 1e15 USDC.
- **Config deviations**: `medusa.json` workers 6 (shared machine); FuzzTester balance 2^96-1 (the template's 2^192-1 exceeded the deployer's 2^128-1); `foundry.toml` `[profile.fuzz]` uses `via_ir` with the optimizer off (`ir-no-opt`, stack too deep otherwise) and `bytecode_hash = "ipfs"` in that profile only (the project's `"none"` stops Medusa attributing coverage to contracts with immutables; cycle 1 showed TokenPortal at 1.7% for that reason).

## Coverage Results
| Contract | Target | Achieved | Status |
|----------|--------|----------|--------|
| TokenPortal (core) | 70% | 100% (60/60) | ✅ |
| Permit2DepositRouter (peripheral) | 40% | 100% (37/37) | ✅ |

Source: `fizz_data/coverage-targets.md`, final campaign (run 2). Cycle 2, before the global properties called the public getters, was 85.0% (51/60) and 97.3% (36/37); only the auto-generated public-getter declarations were missing. Targets were lowered from the template because the fuzz profile is `ir-no-opt` (coverage deflated about 10%).

## Skipped Paths
| Contract | Function / Path | Reason |
|----------|----------------|--------|
| Permit2 | Signature validity | MockPermit2 never verifies signatures; the Sepolia fork suite (`test:evm:fork`) pins the real Permit2. The suite checks only what the router hands Permit2 (SP-03) and that a Permit2 refusal blocks the deposit (GL-22). |
| Aztec Inbox | Range checks | CapturingInbox accepts anything; the portal's own u128 and field-element caps are what is tested. |
| Aztec L2 | Merchant/user rules, who may claim | Out of scope for the L1 suite; the L2 model only tracks supply, claims, returns and exits. |
| TokenPortal / Permit2DepositRouter | Public getters (`registry`, `underlying`, `l2Bridge`, `router`, `rollup`, `outbox`, `inbox`, `rollupVersion`, `initializer`, `PERMIT2`) | No logic; hit once GL-20 called them. Were the only misses in cycle 2. |
| Medusa state | Sequences longer than 100 calls | Medusa resets state between sequences, so model arrays stay small and very deep accumulation (for example hundreds of exits) is not exercised. |

## Campaign Results
- **Fuzzer used**: Medusa 1.5.1
- **Duration**: 5m15s (final run; ended at the 500k test limit)
- **Total calls**: 500,522
- **Branches hit**: 19,266
- **Corpus size**: 249
- **Tests**: 65 passed, 1 failed
- **Violations found**: 1 open root cause (GL-26, 6 stored shrunk sequences, all the same property). One earlier harness false positive, resolved (below).

### Violation Details

#### 1. GL-26 `property_l2LiabilitiesFitU128`
- **Property violated**: `property_l2LiabilitiesFitU128` (GL-26)
- **Guarantee**: `EXPLORATORY`
- **Assertion**: `lte(ghosts.l2Supply + ghosts.pendingDepositAmount, type(uint128).max, "GL-26: l2Supply + pending exceeds u128 max")`. Failure text: `Invalid: 680564733841876926926749214863536422910>340282366920938463463374607431768211455`.
- **Root cause**: the portal caps each deposit at u128 (`AmountExceedsL2Max`) but not the running total, so one max-amount deposit plus any other leaves L2 owing more than the u128 amount type holds. Reachable only because the mock token mints without limit. Circle USDC supply (about 1e17 base units) is far below 2^128, so the cap cannot be reached with the real token. If it were reached, the L2 claim could not mint, but the deposit stays returnable through the return path, so no funds would be lost.
- **Severity assessment**: `needs human review` (practically unreachable with real USDC; a design note, not a loss of funds)
- **Reproducing sequence** (shrunk, from `corpus_medusa/medusa-run.log`; 6 stored files in `corpus_medusa/test_results/` all end in this property):
  1. `permit2DepositRouter_deposit_maxAmount(646199858372766091036533894826178644077715204506982617443392850, true)` sender 0x30000
  2. `permit2DepositRouter_deposit_maxAmount(424257382445414215404692937891749189457689263455797751280640056, false)` sender 0x10000
  3. `property_l2LiabilitiesFitU128()` sender 0x20000
  Other stored shrinks pair `tokenPortal_depositToAztecPublic_maxAmount` / `tokenPortal_depositToAztecPrivate_maxAmount` / `permit2DepositRouter_deposit_clamped` with a second deposit.
- **Foundry repro**: `test_repro_property_l2LiabilitiesFitU128` in `FoundryTester.sol` - `PASS` (violation reproduces). It uses a direct public max deposit plus a clamped private deposit, then asserts `pendingDepositAmount > type(uint128).max` and that the property reverts.

#### Resolved: SP-08 false positive in `tokenPortal_withdraw_tampered` (run 1)
- **Property violated**: SP-08 (refused call is a no-op), asserted inside the `tokenPortal_withdraw_tampered` handler. Run 1 only; not present in the final run.
- **Guarantee**: `SHOULD-HOLD`
- **Root cause**: two identical withdraw messages (same recipient, amount and caller) proven as sibling leaves mean a tamper that moves the leaf index is a genuine payout of the sibling, not a forgery. The portal behaved correctly.
- **Severity assessment**: `test harness false positive` (fixed)
- **Fix**: the handler skips a tamper whose altered tuple is itself a proven, unpaid modelled exit (`_isProvenUnpaid`).
- **Foundry repro**: `test_harness_tamperSkipsIdenticalSibling` guards the fix (a regression test, not a `test_repro_*`).

## Properties Implemented
Confidence is my assessment of how robustly each assertion is written, from reading `Properties.sol`. Guarantee tags are copied from `PROPERTIES.md`; all 53 are `[x]` implemented.

| # | Property | Type | Guarantee | Confidence |
|---|----------|------|-----------|------------|
| GL-01 | property_reserveIdentity | Global | SHOULD-HOLD | HIGH - exact equality, subtraction guarded; but `withdrawn` counts only `tokenPortal_withdraw`, so a payout elsewhere trips it as well as GL-17 |
| GL-02 | property_solvent | Global | SHOULD-HOLD | HIGH - strict `>=` against all three obligations |
| GL-03 | property_surplusIsDonations | Global | SHOULD-HOLD | HIGH - exact; catches over- and under-collateral |
| GL-04 | property_depositFlowConserved | Global | SHOULD-HOLD | HIGH - exact identities, guarded subtractions; model-only (ghost vs ghost), not contract state |
| GL-05 | property_l2SupplyMatchesBalances | Global | SHOULD-HOLD | MEDIUM - sums only the 3 modelled L2 accounts plus an off-account ghost; model-vs-model |
| GL-06 | property_exitLedgerSums | Global | SHOULD-HOLD | MEDIUM - iterates the whole ledger, but the last two checks are skipped once `unbackedPayouts > 0` |
| GL-07 | property_exitLifecyclePartition | Global | SHOULD-HOLD | MEDIUM - list-partition consistency of the model; guards the harness more than the protocol |
| GL-08 | property_routerHoldsOnlyDonations | Global | SHOULD-HOLD | HIGH - exact equality on the router balance |
| GL-09 | property_routerAllowanceZero | Global | SHOULD-HOLD | HIGH - exact, checked between calls |
| GL-10 | property_oneMessagePerDeposit | Global | SHOULD-HOLD | HIGH - Inbox count equals deposit count equals model length; counts, not content (content is GL-23) |
| GL-11 | property_lastMessageAddressed | Global | SHOULD-HOLD | MEDIUM - checks only the latest message, so an earlier misaddressed one is missed unless caught at its own deposit |
| GL-12 | property_depositModelSums | Global | SHOULD-HOLD | MEDIUM - model self-consistency; correctness rests on `_recordDeposit` |
| GL-13 | property_usdcSupplyAccounted | Global | EXPLORATORY | MEDIUM - covers the 3 actors, portal, router and fee sink; a token landing anywhere else is flagged, but donations from non-actors are not modelled |
| GL-14 | property_infraHoldsNoUsdc | Global | EXPLORATORY | MEDIUM - checks fixed addresses only; mocks (Permit2, Inbox) differ from the real contracts |
| GL-15 | property_outboxNullifierMatchesPaid | Global | SHOULD-HOLD | HIGH - cross-checks the real Outbox bitmap against the model; epochs the Outbox reverts on are skipped via try/catch |
| GL-16 | property_depositPathsSum | Global | EXPLORATORY | LOW - ghost-vs-ghost sum, near-tautological (both are bumped in the same handler) |
| GL-17 | property_payoutsAuthentic | Global | SHOULD-HOLD | MEDIUM - counters only; strength depends on the replay, tamper, wrong-caller handlers setting them (tamper skips identical siblings) |
| GL-18 | property_noSelfPayout | Global | SHOULD-HOLD | MEDIUM - counter set by one handler path (`env_secondary`, an L2-bug exit naming the portal) |
| GL-19 | property_noTakeover | Global | SHOULD-HOLD | MEDIUM - counters set by stranger/initializer re-init and stranger `...For` handlers only |
| GL-20 | property_bindingsFrozen | Global | SHOULD-HOLD | HIGH - compares all 12 bindings to setup values |
| GL-21 | property_boundaryRefused | Global | SHOULD-HOLD | MEDIUM - counter; covers over-u128, field-boundary and malformed intents only |
| GL-22 | property_permit2RejectHonoured | Global | SHOULD-HOLD | MEDIUM - counter; MockPermit2 refusal is a mock, not the real signature path |
| GL-23 | property_messagesTruthful | Global | SHOULD-HOLD | HIGH - counter fed by an independent sha256>>8 content-hash model at every deposit |
| GL-24 | property_noReentry | Global | SHOULD-HOLD | MEDIUM - only the one armed hook shape (a single call-back into portal/router) |
| GL-25 | property_noNetPayoutOverDeposits | Global | SHOULD-HOLD | MEDIUM - three ghost inequalities, sound but weak (`<=`) |
| GL-26 | property_l2LiabilitiesFitU128 | Global | EXPLORATORY | MEDIUM - correct and strict, but only reachable via the unbounded mock mint (see violation above) |
| GL-27 | property_noFreeProfit | Global | SHOULD-HOLD | MEDIUM - inequality over 3 actors; slack equals total funding, so small leaks hide |
| GL-28 | property_noStuckPayableExit | Global | EXPLORATORY | MEDIUM - counter gated on a hand-defined "healthy environment"; a wrong gate hides or invents stuck exits |
| GL-29 | property_depositsLive | Global | EXPLORATORY | MEDIUM - covers amounts 1..MAX_REALISTIC_AMOUNT in Normal mode only |
| GL-30 | property_inexactTokenRefused | Global | SHOULD-HOLD | MEDIUM - amounts under 100 are exempt (1% fee floors to 0), so sub-100 fee drift is not tested |
| GL-31 | property_foreignDomainRefused | Global | EXPLORATORY | MEDIUM - covers the foreign sender, version and recipient variants the handler builds |
| SP-01 | property_directDepositPost | Specific | SHOULD-HOLD | HIGH - exact portal credit, one message, bystanders untouched; caller debit only `>=` (token may charge more) |
| SP-02 | property_routerDepositPost | Specific | SHOULD-HOLD | HIGH - exact deltas; signer pays exactly `amount` in a clean env |
| SP-03 | property_routerPermit2Binding | Specific | SHOULD-HOLD | HIGH - checks every Permit2 argument and the witness hash |
| SP-04 | property_secretHashPassthrough | Specific | SHOULD-HOLD | HIGH - exact bytes32 equality |
| SP-05 | property_inboxIndexAdvances | Specific | EXPLORATORY | LOW - relies on CapturingInbox's return semantics, not the real Inbox |
| SP-06 | property_withdrawPost | Specific | SHOULD-HOLD | HIGH - exact portal debit, no one else credited; recipient credit only `>=` to allow token fees |
| SP-07 | property_thirdPartySubmitNoSkim | Specific | SHOULD-HOLD | MEDIUM - only runs in a clean env and only when the recipient is an actor |
| SP-08 | property_refusedCallIsNoop | Specific | SHOULD-HOLD | HIGH - covers balances, allowance, counts, model lengths and Outbox leaf statuses; the tamper false positive is fixed |
| SP-09 | property_portalNeverShrinksExceptWithdraw | Specific | SHOULD-HOLD | HIGH - strict per-handler monotonicity |
| SP-10 | property_routerNeverShrinks | Specific | SHOULD-HOLD | HIGH - strict per-handler monotonicity |
| SP-11 | property_inboxCountMoves | Specific | SHOULD-HOLD | HIGH - exact +1 or +0 |
| SP-12 | property_depositWithdrawIsolation | Specific | EXPLORATORY | MEDIUM - side-state isolation; depends on which fields are snapshotted |
| SP-13 | property_accumulatorsMonotone | Specific | EXPLORATORY | LOW - checks harness ghosts, not protocol state; value is guarding the harness |
| SP-14 | property_freshPortalInitOnce | Specific | SHOULD-HOLD | HIGH - re-init by initializer and stranger both refused; all bindings re-compared |
| SP-15 | property_strangerInitKeepsSlot | Specific | SHOULD-HOLD | HIGH - covers refused stranger, misbound router, and a later real init |
| SP-16 | property_roundTripClaimExit | Specific | SHOULD-HOLD | HIGH - exact restore of actor and portal in a clean env |
| SP-17 | property_roundTripNoProfitAnyMode | Specific | SHOULD-HOLD | MEDIUM - inequality only, across all token modes |
| SP-18 | property_roundTripReturn | Specific | SHOULD-HOLD | HIGH - exact restore in a clean env, direct and router |
| SP-19 | property_roundTripDustCycles | Specific | SHOULD-HOLD | MEDIUM - inequality only; 1..4 cycles, X in 1..199 |
| SP-20 | property_withdrawThenRedeposit | Specific | SHOULD-HOLD | HIGH - exact reserve and one pending deposit of exactly the amount |
| SP-21 | property_directRouterEquivalent | Specific | SHOULD-HOLD | HIGH - same credit and identical Inbox content hash across paths |
| SP-22 | property_zeroAmountSafe | Specific | SHOULD-HOLD | HIGH - zero deposit moves no USDC and creates no claimable value; router zero reverts cleanly |

## Open TODOs
None. `grep TODO` under `test/fizz/` returns no matches.

## Next Steps
1. **Test harness false positives**: none open. The run-1 SP-08 tamper false positive is fixed (skip when the altered tuple is a proven, unpaid sibling) and guarded by `test_harness_tamperSkipsIdenticalSibling`.
2. **GL-26 decision**: needs a human call. Either add a one-line total cap in the portal (reject a deposit that would push cumulative liabilities over u128) or accept it, since real USDC supply (~1e17) is far below 2^128. If accepted, change the mock mint to a realistic supply bound (or cap `MAX_REALISTIC_AMOUNT`-style in the max-amount handlers) so the property stays green and can catch real regressions.
3. **LOW-confidence properties**: GL-16 (ghost-vs-ghost sum; replace with a check against `portal`/`router`-observed credits per path), SP-05 (mock-dependent; pin against the real Inbox in the fork suite), SP-13 (harness-only; keep as a guard, do not count as a protocol property). GL-05/GL-07/GL-12 are model-consistency checks of the same kind.
4. **Coverage**: no ❌ or ⚠️. Both contracts are at 100% line coverage (TokenPortal 60/60, router 37/37).
5. **Tooling bug in the fizz skill**: `run_medusa.js` looks for `branches hit:` but Medusa 1.5.1 prints `branches:`, so plateau detection never fires and every run goes to the 500k test limit. Fix the regex before relying on early stopping.
6. **Untested config**: `echidna.yaml` has never been run (Echidna not installed). Install Echidna to get a second engine, and Slither for the `slither` integration (disabled).
7. **Recommended duration**: current runs are 2-5 minutes at 500k calls. Production validation: at least 5M calls (or 1+ hour) with a larger worker count on an idle machine, plus a re-run on any contract change and with `bytecode_hash = "ipfs"` kept in `[profile.fuzz]`.

## Running Campaigns Manually
- `medusa fuzz` (from `contracts/evm`)
- `echidna test/fizz/FuzzTester.sol --contract FuzzTester --config echidna.yaml` (Echidna not installed here; config untested)
- Foundry repros and regressions: `FOUNDRY_PROFILE=fuzz forge test --match-contract FoundryTester -vvv`
