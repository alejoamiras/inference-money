---
plan: tob-contracts-audit
tier: mid
driver: claude-code
eli5_mode: artifact
code_review: off
claude_model: opus
codex: default model (GPT-6 Astra), high effort
harden: none
baseline: be70fec
status: completed 2026-10-03 (PRs #22, #23 and the close-out on top)
---

## Outcome

**2026-10-03: completed; the work lands when the owner merges the stack.**

- **PR #22, arc 1, no deployed-code change:** the exits' L1 payout rule in the static guard (F-1), six refusal tests (F-2), the tests that kill the surviving L1 mutants (F-6), and USDC's controls documented (F-4).
- **PR #23, arc 2, needs the redeploy:**
  - events for every admin change and L1 payout, asserted in forge and on a local network (F-3);
  - the router's transient guard (F-7);
  - Slither in CI with the audit's results fixed (F-5).
- **The docs-only close-out** sits on top.

All seven findings are fixed and nothing was dropped. Three changes from the plan:

- **Slither:** the arc 2 review found that a path filter hides `src/` findings that run through a library. The filter is gone, and the owner excluded `pragma`, which then fired on the dependencies' own ranges.
- **`PortalInitialized`:** it indexes `underlying`, which Slither's `unindexed-event-address` required.
- **Codex loops:** arc 1 converged in round 3, arc 2 in round 2, and the cross-arc pass in round 2.

The testnet deployment stays stale until the owner's keyed redeploy, tracked in `follow-ups.md`.

**This plan is closed. Its `/goal` and `/loop` seeds below are retired: never run them.**

# Fix the Trail of Bits contracts audit findings

The 2026-10-03 audit of the contracts with the Trail of Bits methodology (Slither, mutation testing with mewt on Solidity and by hand on Aztec.nr, the maturity scorecard) found 0 Critical, 0 High, 3 Low and 4 Informational, re-checked against `main` at `be70fec`. All seven are fixed here. Its report is a private Claude Doc (`8539dca0-d839-4e73-99c9-fa8821e21ef2`); its raw output (`audit/tob/2026-10-02-9f84cdb/raw/`) is git-excluded and lives only in this worktree.

| ID | Sev | Finding | Fix |
|---|---|---|---|
| F-1 | Low | Deleting either exit's `message_portal` payout passes every CI check: TXE exposes no L2→L1 messages, and `check-sole-consumer.sh` pins only the returns' payouts | the static guard pins the exits' payouts too |
| F-2 | Low | Six admin refusals have no test (bridge `transfer_ownership` owner and zero, `cancel_ownership_transfer` owner and nothing pending; token `propose_merchant_admin`, `sync_merchant_delay`) | six TXE tests |
| F-3 | Low | No events for the portal's `initialize` and `withdraw`, the bridge's pause and ownership, the token's admin, guardian and delay setting | one event per action, asserted |
| F-4 | Info | USDC's blocklist, pause and upgradeability are undocumented as bridge behaviour | docs |
| F-5 | Info | No static analysis in CI | Slither in the `contracts` workflow |
| F-6 | Info | L1 tests miss the private deposit's return values, a non-zero Inbox index, a token that over-delivers, the router mismatch's both sides | targeted forge tests |
| F-7 | Info | The router uses OpenZeppelin's storage `ReentrancyGuard` where the portal uses the transient one | `ReentrancyGuardTransient` |

## Owner decisions (2026-10-03)

- **Redeploy:** the testnet frontend is already stranded (stale token class id since 56c8665), so changes needing a redeploy are in. Code only: no testnet run here; the redeploy stays the owner's keyed run.
- **F-1:** a static guard rule, not a new runtime harness.
- **F-5:** Slither only (no mutation testing in CI). Fix `missing-inheritance` and `events-maths`; mark the router's `reentrancy-balance` a reviewed false positive inline; exclude `naming-convention` (upstream Aztec's `_param` style). Added during the arc 2 review (2026-10-03): no path filter, and exclude `pragma` (the npm dependencies' own ranges).
- **F-6:** the router mismatch is a fuzz test.
- **F-3:** one event per action.
- **Scope:** the audit's findings only; the maturity scorecard's quality items stay out.
- **Delivery:** two stacked PRs (no deployed-code change, then the redeploy-requiring change) and a docs-only close-out.
- **Gates:** fast (lint, typecheck, unit), contracts (forge, halmos, gas, TXE, static guard, artifacts), integration on a local network. No `/code-review`, no `/harden`. Claude leg: Opus 5.5.

## Outcome & Quality Bar

- **For whom:** an external auditor and the owner preparing the handoff, who read CI as evidence; an integrator or indexer watching the contracts; the next maintainer who edits an exit or an admin function.
- **Excellent:**
  1. Every survivor the audit called a gap is killed by CI. For each new test or rule, the lessons log records the mutation it kills, shown by applying that mutation and watching the gate fail for that reason, then restoring the source.
  2. From the deployment's initial state plus events, an indexer can follow every admin-controlled change: the bridge's owner, pending owner and pause flag; the token's merchant admin, pending admin, guardian schedule and delay setting; the portal's binding and every L1 payout. Each event is asserted once, so deleting an emit fails a gate: in forge (L1, in CI) or on a real network (L2, the integration spec, which runs in the local phase gate: CI has no pinned Aztec node).
  3. Slither runs in CI from a hash-locked install and fails on any new finding; each kept exception carries its reason next to it.
  4. Nothing else moves: no storage, message hash, selector or upstream signature changes; `abi-superset.test.ts` lists exactly the added events; halmos still proves exactly 11.
- **Good enough:** no new runtime harness for L2→L1 messages, no mutation testing in CI, no event for actions that already have one (merchant entries) or whose effect is a message (exits, deposits), no testnet run.

## Phases

### Arc 1: `tob-tests` (branch `worktree-tob-contracts-audit`), no deployed-code change

#### Phase 1: the exits' payout rule (F-1) ✓

In `contracts/aztec/scripts/check-sole-consumer.sh`:

1. A `pays_recipient <fn> <body>` helper beside `pays_depositor`:
   - `bound_to` the `withdraw_content_hash(recipient, amount, caller_on_l1)` binding, the call being the whole initializer (`let <var> = withdraw_content_hash(recipient, amount, caller_on_l1);`, nothing between `)` and `;`: `bound_to` alone accepts `… + 1` or `… * (as_merchant as Field)`), and exactly one `let <that variable>` in the body (no shadowing between the hash and its use);
   - no `let` (or `let mut`) rebinding `recipient`, `amount` or `caller_on_l1` anywhere in the body: the hash names the parameters by text, so a rebound `recipient` after the funding check would pay someone else and pass every other rule;
   - `need` exactly `message_portal(config.portal, <that variable>)`, and exactly one `message_portal`;
   - the payout runs at function scope: the brace depth before `message_portal` (string literals stripped, struct-literal braces balanced) is the function's own. Without this, the pair moved inside `if as_merchant { … }` passes every other check while user exits burn and pay nothing on L1 (`flow_is` only counts the branch conditions).
   Called from `check_exits` for both exits.
   A `config_once <fn> <body>` helper, called for all six checked functions (the four consumers name `config.portal` as their sender, the four payers as their target): exactly one `let config`, it is `let config = self.storage.config.read();`, and no `let mut config`. Otherwise a second `let config = Config { portal: caller_on_l1, .. }` after the checks keeps the token and proxy and redirects the message.
2. Self-test mutants, each rejected for a reason no other mutant gives (the two hash-argument mutants target different exits, via `nth`, so their reasons name different functions): the public exit's payout deleted; the private exit's payout deleted (nth 2); a second `message_portal` in one exit; the public exit hashing `config.portal` in place of `recipient`; the private exit hashing `EthAddress::zero()` in place of `caller_on_l1`; the private exit's hash and payout moved into the `as_merchant` branch; the bound content shadowed by a second `let` before the payout; `let recipient = caller_on_l1;` inserted after the private exit's funding check; the public exit's hash initializer extended with `+ 1`; a second `config` binding with its portal replaced by `caller_on_l1`, inserted before the private exit's payout.
3. The header comment's exit lines say each exit pays `recipient` on L1, once and unconditionally, with the caller it was given.

**Validation gate.** Commands: `bash contracts/aztec/scripts/check-sole-consumer.sh --self-test && bash contracts/aztec/scripts/check-sole-consumer.sh && bun run lint`. Pass: exit 0; the self-test prints each new mutant with its own reason. Layers: lint (shellcheck), the static guard.

#### Phase 2: six refusal tests (F-2) ✓

1. `contracts/aztec/token_bridge/src/test/ownership.nr`, in `pause.nr`'s `non_owner_cannot_pause` shape: `non_owner_cannot_transfer_ownership` ("Only owner"), `ownership_cannot_go_to_the_zero_address` ("New owner cannot be zero address"), `non_owner_cannot_cancel_an_ownership_transfer` ("Only owner", with a transfer pending so only the owner check can refuse), `cancel_refuses_with_nothing_pending` ("No pending owner").
2. `contracts/aztec/token/src/test/merchants.nr`, in `add_merchant_is_admin_only`'s shape: `propose_merchant_admin_is_admin_only`, `sync_merchant_delay_is_admin_only` (on a listed merchant, so only the admin check can refuse). Both "Only the merchant admin".
3. Each name in its crate's `txe-manifest.txt`, sorted in place; floors in `run-txe-tests.sh` raised to 78 (bridge) and 164 (token).
4. Commit the tests, manifests and floors, so the kill proofs below can never discard them.
5. Kill proof, logged in `lessons/phase-2.md`. For each refusal, one at a time: delete it from the production source (the bridge's four asserts individually; in the token, the `self.internal._assert_merchant_admin()` call in `propose_merchant_admin`, then the one in `sync_merchant_delay`, never the shared assert in `_assert_merchant_admin`, which every admin test already covers), `bash contracts/aztec/scripts/compile.sh <crate>`, run that crate's TXE suite, confirm the new test fails, then `git restore -- contracts/aztec/<crate>/src/main.nr contracts/aztec/<crate>/target`, which brings back the committed artifact bytes (a recompile would not reproduce them byte for byte: artifact identity excludes debug metadata). One crate at a time: the bridge compiles against the token's source and copies its artifact.

**Validation gate.** Commands: `git diff --quiet HEAD -- contracts/aztec && bash contracts/aztec/scripts/compile.sh --check && bun run test:noir`. Pass: no drift from the committed tests after the kill proofs, the artifacts equal the source, every listed test passes and the counts meet the new floors. Layers: TXE, the artifact-equals-source check.

#### Phase 3: L1 test gaps (F-6) and the USDC docs (F-4) ✓

The audit's Solidity survivors are forge survivors (`mewt.toml` ran forge only); 11 were then re-run against halmos, which caught one (287, the initializer check) and left 275, 270, 310, 95, 122, 30, 315, 204, 316, 317. Line offsets in `mewt-results.json` are 0-based against `9f84cdb`. Each remaining non-equivalent survivor is killed by one test:

1. `test/TokenPortal.t.sol`: a public and a private deposit made second, at Inbox index 1 (`CapturingInbox` counts from 0; deposit twice rather than change the shared mock), assert their **returned** `(key, index)` equal the Inbox's (315 and 317 replace the returned index with 0; 204 and 316 drop or zero the private return).
2. `test/mocks/TestTokens.sol`: `OverDeliveringERC20` (credits `amount + 1` on a transfer into the portal or router, mirroring `FeeOnTransferERC20`'s `_update` override). The portal's deposit reverts `InexactTransfer` (310) and the router's `deposit` reverts with exactly `InexactPull`'s selector (95: under that mutant the portal's `InexactTransfer` fires instead, so a bare `expectRevert` would not kill it). The withdraw side is already covered (`SenderSurchargeERC20`, `TokenPortal.t.sol:231`).
3. `test/TokenPortal.t.sol` (beside the unit test whose fixture it shares): `testFuzz_initialize_refusesAMismatchedRouter(address other)`, each run on two fresh uninitialized portals: a `StubRouter` with the wrong portal and the right token, and one with the right portal and the wrong token, each `RouterMismatch` (275, 270; `vm.assume(other != right)`, random addresses fall on both sides of the comparison). Fuzzing both sides at once would leave the unmutated half of the `||` to refuse.
4. `test/Permit2DepositRouter.t.sol`: `test_senderSurchargeCannotSpendDonations` (122). With `SenderSurchargeERC20(100)` the Permit2 pull and the portal's credit are both exact, but the router pays the 1% surcharge on its transfer to the portal; with a donation sitting in the router, `_checkSettled` must revert `ResidualBalance` rather than let the donation pay the fee (the router's header promises donations are never spent). `_deployStack(new SenderSurchargeERC20(100))`, fund the user with the amount plus 1%, donate at least 1% to the router, `vm.expectRevert(ResidualBalance.selector)`.
5. Equivalent survivors stay out, listed in `lessons/phase-3.md` with why: 81, 86, 91 (`code.length <= 0`), 101, 112, 116 (`<=`/`>` against zero on unsigned values), 292 (`address(registry) > address(0)`, the same on an address), 30 (the reset of a finite approval the portal spent exactly; `_assertRouterClean` already asserts zero allowance, `Permit2DepositRouter.t.sol:182`).
6. Commit the tests and the mock first. Kill proof: apply each survivor's substitution to `contracts/evm/src`, run the new test, `git restore -- contracts/evm/src`, log it.
7. Docs: `docs/architecture.md`, a bold-lead paragraph after **Withdraw (L2 → L1).**: USDC can blocklist the recipient (the withdraw reverts and the message stays consumable, retriable to the same recipient only, `test_blacklistedRecipient_revertsAtomicallyAndStaysRetriable`), blocklist the portal (every deposit and withdraw stops), and pause (both stop). An upgrade that adds a fee: a deposit must credit the portal exactly `amount`, so a fee on deposits refuses them; a withdraw must debit the portal exactly `amount` and does not check what the recipient nets, so a fee charged to the recipient passes. `docs/integration.md`, one line under "Messages between the chains" pointing to it.

**Validation gate (the arc's last).** Commands: `git diff --quiet HEAD -- contracts && bun run test:evm && bun run test:evm:gas && bun run test:evm:formal && bun run lint && bun run typecheck && bun run test`. Pass: all exit 0, no drift from the committed tests after the kill proofs; halmos "exactly the 11 expected proofs passed". Layers: lint, typecheck, unit, forge (unit, fuzz, invariant), formal, gas.

**Arc 1 quality loop:** the Codex fix loop of the Post-implementation section, over the arc's diff, before `gh stack add`.

### Arc 2: `tob-events` (branch `tob-contracts-events`, stacked on arc 1), needs a redeploy

#### Phase 4: L2 events (F-3, Aztec.nr) ✓

1. `token_bridge/src/main.nr`: `#[event]` structs `PauseSet { paused }`, `OwnershipTransferStarted { owner, pending_owner }`, `OwnershipTransferCancelled { owner, pending_owner }`, `OwnershipTransferred { previous_owner, new_owner }`, declared before `constructor` (the static guard takes a body up to the next ` fn `). `self.emit(...)` at the end of `set_paused`, `transfer_ownership`, `cancel_ownership_transfer` (the pending owner read before it is cleared), `claim_ownership` (the previous owner read before it is replaced). Edit only those lines: the guard's mutants match multi-line literals. Same rule in the token: `accept_merchant_admin` reads the previous admin before the write.
2. `token/src/main.nr`: `MerchantAdminProposed { pending_admin }` (zero withdraws), `MerchantAdminAccepted { previous_admin, admin }`, `MerchantGuardianScheduled { guardian, effective_at }`, `MerchantDelaySet { delay, guardian_delay_effective_at }`, declared after the three entry events under one comment line of their own (the comment at `:72` stays true: these are not entry changes). `set_merchant_delay` gets its own event: it changes a setting, not an entry, so `MerchantDelayScheduled` stays an entry event; it also reschedules the guardian slot's delay, so the event carries when that applies (`merchant_guardian.get_scheduled_delay()`).
3. `bash contracts/aztec/scripts/compile.sh token`, then `token_bridge` (the bridge compiles against the token). The class ids in `packages/bridge-core/src/artifacts.test.ts`. The four token events in `ADDED_EVENTS` (`contracts/aztec/scripts/abi-superset.test.ts`).
4. bridge-core: `contractEvent(artifact, name)` generalizes `tokenEvent` (`merchants.ts`), which stays as its token wrapper. Its unit test covers the path lookup and the missing-event error; a bridge event has no independent selector source to pin against (the token's `Transfer` pin checks aztec-standards' codegen), so the integration spec is its proof.
5. `packages/integration/test/operator.test.ts` (it already performs every one of these actions): each drift case asserts its event, every field, with `getPublicEvents` filtered to the contract and to the tx's hash where the call returns a receipt; where it does not (`proposeAdmin`, `acceptAdmin`, the CLI's `admin propose`), from a block number read before the call. Deleting an emit or misreading an overwritten value fails the spec: `PauseSet` (pause and unpause), `OwnershipTransferStarted` and `MerchantAdminProposed` (propose), `OwnershipTransferCancelled` and the zero `MerchantAdminProposed` (withdrawal), `MerchantGuardianScheduled`, `MerchantDelaySet`, and in [A28] `OwnershipTransferred` and `MerchantAdminAccepted` (accept).
6. Commit the rebuilt artifacts with their sources; `compile.sh --check` passes only after that commit.

**Validation gate.** Commands, after step 6's commit: `bash contracts/aztec/scripts/compile.sh --check && bash contracts/aztec/scripts/check-sole-consumer.sh --self-test && bash contracts/aztec/scripts/check-sole-consumer.sh && bun run test:noir && bun run lint && bun run typecheck && bun run test && bun run test:integration`. Pass: all exit 0; `abi-superset.test.ts` reports exactly the four added events, no function or storage, bytecode under its ceiling. Layers: lint, typecheck, unit, TXE, the artifact-equals-source check, the static guard, integration on a local network.

#### Phase 5: L1 events, the router guard, Slither (F-3, F-7, F-5) ✓

1. `TokenPortal.sol`: `event PortalInitialized(address registry, address indexed underlying, bytes32 l2Bridge, address router, address rollup, address inbox, address outbox, uint256 rollupVersion)` at the end of `initialize` (the Outbox is `withdraw`'s only authority, so the binding is incomplete without it); `event Withdraw(address indexed recipient, uint256 amount, address callerOnL1)` after the exact-debit check in `withdraw`. `amount` is the reserve's debit and the message's amount, not what the recipient nets; `callerOnL1` is the caller the message was hashed with, zero meaning anyone could execute it, never the tx sender. `TokenPortal is ITokenPortal, ReentrancyGuardTransient`. Header comment: one line for the events.
2. `Permit2DepositRouter.sol`: `ReentrancyGuardTransient`; `test/Permit2DepositRouter.t.sol`'s import of the guard's error follows.
3. Forge tests: `vm.expectEmit` with every field checked for both events (`initialize` in the setup's own test, `withdraw` through the fake Outbox and through `PortalWithdrawRealOutbox`, with and without a caller).
4. bridge-core: both events in `TOKEN_PORTAL_ABI` (`abi.ts`), so integrators get them from the SDK; `abi.test.ts` already pins it against the forge ABI.
5. Gas: `forge snapshot --match-test test_gas_ --no-match-contract Fork` from `contracts/evm`, committed; the diff recorded in the lessons file. The snapshot covers routed deposits only, so it measures the guard switch, not the new events.
6. Slither:
   - `toolchain.json`: `"slither": "0.11.6"`. `.github/actions/setup-toolchains/slither-0.11.6.requirements.txt` by the halmos lock's recipe (`uv pip compile --universal --generate-hashes --no-header --exclude-newer <a week before generation>`), with the same header.
   - The action: `slither` added to its pins loop, a `slither` input, its own venv, the same hash-locked wheels-only install, linked into `$RUNNER_TEMP/bin`. Its tree is about 50 wheels (web3, aiohttp, ckzg, pycryptodome among them), all cp-tagged manylinux.
   - `contracts/evm/slither.config.json`: `exclude_dependencies` and `detectors_to_exclude: naming-convention,pragma`, no `filter_paths` (Slither 0.11.6 drops a result when *any* element matches a filter, so one would hide a `src/` finding that runs through a library; `pragma` then fires on the dependencies' own ranges: excluded by the owner, 2026-10-03).
   - `contracts/evm/scripts/slither.sh`, run by `test:evm:slither` (root alias too): `bun scripts/check-remappings.ts`, then an isolated build of `src` alone (`--skip test` still builds `test/mocks`, whose findings drown `src/`'s): `forge build src --out <dir>/out --cache-path <dir>/cache --force --build-info` into a fresh `mktemp -d` under `~/.cache/inference-money/forge/`, then `slither . --foundry-ignore-compile --foundry-out-directory <dir>/out --fail-pedantic`, and the dir removed on exit. Own out and cache, so no stale build info is parsed, no shared `out/` is cleaned and no concurrent `forge test` is raced.
   - `// slither-disable-next-line reentrancy-balance` on the router's line Slither reports, with a one-line reason. The finding is the Permit2 pull followed by the pull-delta check (`slither.json`), so the reason is: the balance before the pull is compared with the balance after it on purpose, and `nonReentrant` refuses a nested deposit during it.
   - `.github/workflows/_contracts.yml` evm job: `slither: "true"` and a step after the gas snapshot.
7. Docs: `docs/ci-pipeline.md` (the Slither step and its exceptions), `AGENTS.md` (the command), `docs/assurance-map.md` (the new tests in A20, A24, A28; the events), `docs/integration.md` (the events an indexer can follow).

**Validation gate (the arc's last).** Commands: `bun run test:evm && bun run test:evm:gas && bun run test:evm:formal && bun run test:evm:slither && bun run lint:actions && bun run lint && bun run typecheck && bun run test && bun run test:integration`. Pass: all exit 0; Slither reports no result; halmos still exactly 11. Layers: lint, typecheck, unit, forge, formal, gas, static analysis, actionlint, integration.

**Arc 2 quality loop:** as arc 1, then the final cross-arc pass.

## Architecture & Implementation

- **Proposed architecture.** No new component. Every fix extends what `recon.md` maps: the static guard gains one rule in the shape of `pays_depositor`; tests follow each suite's existing refusal shape; events follow the token's `#[event]` + `self.emit` pattern and the portal's `vm.expectEmit` tests; Slither installs the way halmos does. The only new code paths are one bridge-core helper (`contractEvent`) and one mock token.
- **Interfaces.** Events are the new public surface, chosen for indexers:
  - Bridge: `PauseSet { paused: bool }`; `OwnershipTransferStarted { owner, pending_owner }`; `OwnershipTransferCancelled { owner, pending_owner }`; `OwnershipTransferred { previous_owner, new_owner }`.
  - Token: `MerchantAdminProposed { pending_admin }`; `MerchantAdminAccepted { previous_admin, admin }`; `MerchantGuardianScheduled { guardian, effective_at: u64 }` (from `get_scheduled_value()`); `MerchantDelaySet { delay: u64, guardian_delay_effective_at: u64 }` (from `get_scheduled_delay()`).
  - Portal: `PortalInitialized(registry, underlying (indexed: Slither's `unindexed-event-address`, and the token is the useful filter), l2Bridge, router, rollup, inbox, outbox, rollupVersion)`; `Withdraw(address indexed recipient, uint256 amount, address callerOnL1)`.
  - bridge-core: `contractEvent(artifact: ContractArtifact, name: string): Promise<EventMetadataDefinition>`; the path is `<artifact.name>::<name>`. Callers keep filtering by contract address, as `merchants.ts` does.
- **Data and control flow.** Each function reads the values it is about to overwrite (the pending owner a cancel clears, the owner or admin an acceptance replaces) into locals before any write, then emits after every assert and write, so the payload states the change as it happened. A reverted tx reverts its logs with it, so a refused change never leaves an event. Public logs reach `getPublicEvents` by event tag; existing readers filter by tag and are unaffected.
- **What the events reconstruct.** An indexer starts from the deployment's initial state (the constructor's owner, admin and delay, the guardian slot's construction-time delay; all readable and checked by `verify`) and follows every later admin change from events. The constructors emit nothing: their state is the baseline.
- **File-level change map.** Arc 1: `contracts/aztec/scripts/check-sole-consumer.sh`, `token_bridge/src/test/ownership.nr`, `token/src/test/merchants.nr`, both `txe-manifest.txt`, `scripts/run-txe-tests.sh`, `contracts/evm/test/{TokenPortal,Permit2DepositRouter}.t.sol`, `test/mocks/TestTokens.sol`, `docs/architecture.md`, `docs/integration.md`. Arc 2: `token_bridge/src/main.nr`, `token/src/main.nr`, both crates' `target/` artifacts, `abi-superset.test.ts`, `bridge-core/src/{merchants,artifacts.test,abi}.ts` (+ the helper's test), `integration/test/operator.test.ts`, `contracts/evm/src/{TokenPortal,Permit2DepositRouter}.sol`, their tests, `.gas-snapshot`, `slither.config.json`, `scripts/slither.sh`, `contracts/evm/package.json`, root `package.json`, `toolchain.json`, the action and its lock, `_contracts.yml`, docs, `AGENTS.md`.
- **Non-obvious mechanics.** The guard reads flattened source and cuts a body at the next ` fn `, so struct placement matters; it matches parameter names by text, hence the no-rebinding and function-scope rules. TXE runs committed artifacts: a source edit tests nothing until `compile.sh` rebuilds, and a recompile does not reproduce committed bytes, so kill proofs restore artifacts with `git restore`. Slither's foundry mode runs `forge clean` unless told to skip compiling, hence its own build dir. A mutant killed only by a specific revert needs `expectRevert(<selector>)`: under 95 another check reverts first.
- **Alternatives not taken.** A runtime L2→L1 check for F-1 (owner chose the static rule; TXE cannot see the message). A mutation job in CI (owner chose Slither only). Renaming the portal's `_param`s for Slither (upstream's names; the exclusion is cheaper and keeps the diff off the ABI). An event on the bridge's constructor (the deploy tx already names the owner). Changing `CapturingInbox` to start at a non-zero index (shared by many tests).

## Security & Adversarial Considerations

- **Threat model.** No new trust: no new role, permission, storage or message. The attacker of interest is a future change that deletes or redirects a payout, a guard or an emit, which this plan makes visible to CI.
- **Events as an attack surface.** An event is information, never authority: no contract reads one. A refused change leaves no event (the revert drops it), and payloads capture overwritten values before the write, so an event cannot misstate who held a role. Events publish nothing private: every L2 field is already public state, and the portal's `Withdraw` adds nothing to what the L1 withdraw's own calldata shows (recipient, amount, whether a caller was required). No event names a private L2 sender. `Withdraw.amount` is documented as the reserve's debit, so an indexer never reads it as the recipient's net receipt under a token fee.
- **Reentrancy.** The router's guard moves from storage to transient with the same selector; the portal has used the transient guard since launch. Halmos re-runs the router's proofs over TSTORE.
- **Static guard tamper.** The rule is text-pinned; its mutants prove each refusal reason. A reformat of `main.nr` breaks the mutants, not the rule's soundness, and fails CI loudly. It is a tripwire for edits that drop, move, alter or redirect a payout, not a proof against a maintainer writing evasive code on purpose; review and the TXE suites cover that. Each tightening here closes a concrete evasion a reviewer found and has its own mutant.
- **Supply chain.** Slither enters through a hash-locked, wheels-only, no-deps install generated with a 7-day cutoff, in its own venv; it never sees a secret (the `contracts` workflow has `contents: read` and no secrets). A Slither bump without a matching lock fails the step, as halmos does.
- **Redeploy.** The token, bridge and portal change bytecode. Testnet keeps running the old contracts until the owner's keyed redeploy, already pending since 56c8665; `implementations-plan/follow-ups.md` covers it. No migration: init-once contracts are redeployed whole.
- **Never in this plan:** keyed runs, testnet commands, secrets, a merge.

## Assumptions

- **Facts:**
  - The exits' payouts are `let content = withdraw_content_hash(recipient, amount, caller_on_l1); self.context.message_portal(config.portal, content);` (`token_bridge/src/main.nr:202-203`, `:236-237`); `check_exits` checks no payout (`check-sole-consumer.sh:172-186`).
  - The six refusals' strings: "Only owner", "New owner cannot be zero address", "No pending owner" (`token_bridge/src/main.nr:51-63`), "Only the merchant admin" (`token/src/main.nr:1052`).
  - `DelayedPublicMutable::get_scheduled_value()` returns `(value, effective_at)`; the token already reads an entry's that way (`token/src/main.nr:674`).
  - TXE suites run committed artifacts, and floors are minimums (`run-txe-tests.sh:22-30`, today bridge 74, token 162).
  - Every admin action is already performed by `operator.test.ts` (L113-156, L211-224); the deployer's `admin.ts` sends the same calls.
  - Slither 0.11.6 on `be70fec`'s sources reports exactly: `reentrancy-balance` (router `deposit`), `events-maths` (`initialize`), `missing-inheritance` (`ITokenPortal`), and 29 `naming-convention` (`audit/tob/.../slither.json`). It has `--foundry-ignore-compile`, `--foundry-out-directory`, `--fail-pedantic`, `--config-file`.
  - `ITokenPortal`'s two functions match `TokenPortal`'s signatures and returns (`src/interfaces/ITokenPortal.sol`).
  - The Solidity survivors are forge survivors (`mewt.toml`'s test command runs forge only); 11 of them were re-run against halmos (`~/.cache/inference-money/tob-mutation/retest-halmos-test.sh.log`), which caught 287 (`msg.sender != initializer`, `TokenPortal.sol:231`, status `TestFail`). 292 is `address(registry) != address(0)` → `>` (`:233`), equivalent on an address.
  - Under `SenderSurchargeERC20` (`test/mocks/TestTokens.sol:35-49`) the router pays a surcharge on its transfer to the portal while the pull and the portal's credit stay exact, so only `_checkSettled` (`Permit2DepositRouter.sol:119`) protects a donation; survivor 122 weakens it.
  - Slither's `slither-disable-next-line` checks the line above each element's first line (`slither_core.py:454-483`); crytic-compile reads `<out>/build-info` (`crytic_compile/platform/foundry.py:132-143`).
  - The deposits' internals end in `return (key, index);` (`TokenPortal.sol:206`, `:224`), the lines survivors 315 and 317 mutate.
  - `_assertRouterClean` already asserts the router's zero allowance (`Permit2DepositRouter.t.sol:182`); `SenderSurchargeERC20` already covers an over-debiting withdraw (`TokenPortal.t.sol:231`).
  - `withdraw` checks the portal's debit, not the recipient's credit (`TokenPortal.sol:180-186`).
  - `flow_is` checks only the list of branch conditions, not where statements sit (`check-sole-consumer.sh:95-106`).
  - `foundry.toml` sets `solc = "0.8.28"` and `bytecode_hash = "none"`.
- **Inferences:**
  - Transient storage costs less than the storage guard on the router's `test_gas_` cases, inside the 2% tolerance; the snapshot is regenerated anyway.
  - The bridge's public bytecode stays far under the protocol's class-registry limit (3,000 packed fields) after four events; the repo checks only the token's tighter 2,700 ceiling, and the integration gate's deploy would fail if the bridge exceeded the protocol's.
  - Noir test modules do not change a contract's compiled artifact, so `compile.sh --check` passes with test-only changes (Phase 2's gate proves it).
  - The integration harness's node serves public logs for these txs through `getPublicEvents`, as it does for `MerchantAdded` today.
- **Asks:** none open. One consequence for the owner at merge: arc 2 changes the class ids and the portal's bytecode, so `deployments/testnet.json` stays stale until the keyed redeploy.

## Decision ledger

**Outline:** A (split at the redeploy boundary) over B (split by chain). Both audits chose A: arc 1 can merge and protect `main` with no redeploy; B makes both PRs change deployed bytecode and mixes test-only Noir work with class-id moves in one review. B's one advantage, Slither green in the PR that clears its findings, already holds in A's Phase 5.

**Plan audit, round 1** (Codex GPT-6 Astra high: "conditional approve"; Opus 5.5: "conditional approve"). Every finding was checked against the repo before adoption.

| # | Source | Finding | Verdict |
|---|---|---|---|
| 1 | Codex | The exit rule accepts the pair moved into the `as_merchant` branch (`flow_is` counts branch conditions only) | adopted: function-scope (brace-depth) rule + mutant |
| 2 | Codex | A shadowed content variable passes | adopted: one `let` of it + mutant |
| 3 | Opus | A rebound `recipient`/`amount`/`caller_on_l1` passes | adopted: no rebinding + mutant |
| 4 | Codex | "Exact-amount checks refuse any fee" is false: withdraw checks the debit only | adopted: docs say each side; `Withdraw.amount` defined as the reserve's debit |
| 5 | Codex | Slither suppression explained the wrong interaction | adopted: the Permit2 pull and its delta check |
| 6 | Codex | Survivors were forge-only, not "forge and halmos" | adopted: Facts corrected |
| 7 | Opus | 292 is the registry zero check (equivalent); the initializer mutant is 287, already caught by halmos | adopted: the initializer step deleted, 292 listed equivalent |
| 8 | Opus | 122 is not equivalent: a sender-surcharge token with a donation in the router | adopted: `test_senderSurchargeCannotSpendDonations` |
| 9 | Codex | 315/317 mutate the returned index, not the event's | adopted: returned values asserted at index 1, public and private |
| 10 | Codex | Fuzzing both router bindings at once leaves the unmutated side to refuse | adopted: one side wrong per case, fresh portals |
| 11 | Codex | The allowance test exists and cannot kill 30 | adopted: 30 listed equivalent |
| 12 | Codex | Token kill proofs must delete each function's admin call, not the shared assert | adopted |
| 13 | Codex, Opus | Kill-proof restoration could discard tests; a recompile does not reproduce committed bytes | adopted: commit tests first, `git restore` src and target, no recompile; gates diff against HEAD and run `compile.sh --check` |
| 14 | Codex | Event payloads must capture overwritten values before the write | adopted |
| 15 | Codex | "Events alone" needs a baseline | adopted: initial state plus events; constructors emit nothing |
| 16 | Codex | Withdraw's privacy rationale named the wrong disclosure | adopted: nothing beyond the L1 calldata |
| 17 | Codex | The SDK ABI update recon found was dropped | adopted: both portal events in `TOKEN_PORTAL_ABI` |
| 18 | Codex | `caller` reads as the tx sender | adopted: `callerOnL1`, zero meaning anyone |
| 19 | Opus | `PortalInitialized` omits the Outbox it trusts | adopted: `inbox` and `outbox` added |
| 20 | Opus | The Slither build shares `cache/` and keeps stale build info | adopted: the deployer's isolated `--out`/`--cache-path`/`--force` build in a temp dir |
| 21 | Opus | "On the tx's block" has no tx for helper-driven calls | adopted: tx hash where a receipt exists, else a block read before the call |
| 22 | Opus | 95 dies only on its exact selector | adopted |
| 23 | Opus | Two Phase 1 mutants would share a reason | adopted: different exits |
| 24 | Opus | Pins loop and remapping check for Slither | adopted |
| 25 | Opus | A bridge event selector pin restates its derivation | adopted: the unit test covers lookup and error only |
| 26 | Opus | `set_merchant_delay` also reschedules the guardian delay, which no event dates | adopted: `guardian_delay_effective_at` in `MerchantDelaySet` (completes the owner's "one event per action"; no new decision) |
| 27 | Codex, Opus | 29 `naming-convention`, not 28; the protocol's bytecode limit applies to the bridge | adopted: Facts and Inferences corrected |
| 28 | Opus | The `:72` comment flagged by recon | rejected: it says "entry" and stays true; the new events get their own comment line |
| 29 | Codex | The over-debit withdraw case duplicates `SenderSurchargeERC20` | adopted: dropped |

**Final fresh-context pass** (Codex GPT-6 Astra high, new session, with this ledger): "VERDICT: conditional approve (with conditions: pin the complete hash initializer and stored config binding, and add self-test mutants for altered hashes and redirected portals)". Facts, Inferences, Asks: none to correct. Event payloads, Slither, the Phase 2 and 3 tests and the gate order: no finding. Both conditions adopted:

| # | Source | Finding | Verdict |
|---|---|---|---|
| 30 | Codex final | `bound_to` accepts an altered initializer (`… + 1`, `… * (as_merchant as Field)`): one binding, function scope, wrong hash | adopted: the call is the whole initializer + mutant |
| 31 | Codex final | A shadowed `config` redirects `config.portal` while the token still burns | adopted: `config_once` for all six checked functions + mutant |

**Disputes:** none open.

## Delivery

| Arc | Phases | Stacks on | `/code-review` |
|---|---|---|---|
| `tob-tests` (`worktree-tob-contracts-audit`) | 1, 2, 3 | `main` | off |
| `tob-events` (`tob-contracts-events`) | 4, 5 | `tob-tests` | off |
| `tob-contracts-audit-close-out` (docs only) | close-out | `tob-events` | off |

`gh stack init --adopt worktree-tob-contracts-audit`; `gh stack add tob-contracts-events` only after arc 1's loop converges. No PR, draft or not, before every loop has converged.

## Post-implementation

Before any install, build or test: confirm no keyed run is live on the host.

1. **Codex audit, per arc at its boundary** (`/codex high`): the arc's diff, this plan and its decision ledger, the arc map ("arc N of 2; arc 1 adds tests, a static rule and docs with no deployed-code change; arc 2 adds events, the router's transient guard and Slither, which need a redeploy"), the adversarial ask ("What could go wrong? What would an attacker target? What are we trusting that we shouldn't? Where are the supply-chain, crypto or least-privilege weaknesses?"), and both rules below, verbatim, in every prompt, initial and resumed:
   - *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
2. **Fix loop:** verify each claim against the repo, apply what is accepted, commit, log the round in `lessons/phase-N.md`, resume the same Codex session with the fix diff. Repeat until a round yields nothing material. Still material after 3 rounds: stop and report to the owner.
3. **Cross-arc pass:** after both arcs, a fresh Codex session over the net diff from `be70fec`, asking for seams between the arcs, duplication across them and drift from this plan, with both rules; same loop.
4. **Delivery:** `gh stack sync` if `main` moved, `gh stack submit --auto`, then `gh pr edit` each body (arc 2's says the testnet deployment stays stale until the keyed redeploy). Then `gh stack add tob-contracts-audit-close-out`, the close-out commits, `gh stack submit --auto`, `gh pr checks --watch`.
5. **Close-out**, the docs-only top layer:
   - An `## Outcome` block directly after this front matter: date, status, PR numbers, what was dropped and why, and a line retiring the seeds below.
   - Promote the generalizable gotchas into `implementations-plan/lessons.md`, one line each linking to the archived detail, inside its ~8 KiB budget: dedupe, retire what the new entry supersedes, date-stamp tool-version lines.
   - `implementations-plan/follow-ups.md`: extend the testnet redeploy line to name these contract changes; add anything deferred. Reconcile the three shared files against `main` first.
   - `git mv implementations-plan/tob-contracts-audit implementations-plan/archive/tob-contracts-audit` in its own commit; repair links (`git grep -n tob-contracts-audit`); move the index line to `archive/index.md`, completed.
6. **The audit's report:** mark each finding fixed with its PR in the Claude Doc (`8539dca0-d839-4e73-99c9-fa8821e21ef2`).
7. Report and stop. Merging is the owner's call.

## Seeds

Final: the owner approved the plan unchanged on 2026-10-03 and set the `/goal` below. Plain-language companion (Artifact): https://claude.ai/artifact/DqQK72h3z1QJPwpMZ7qj5Q · source `implementations-plan/tob-contracts-audit/eli5.html` (written locally, never committed).

```
/goal Every phase header in implementations-plan/tob-contracts-audit/plan.md is marked ✓ in the file, each backed by its validation gate reported passing in the transcript and a printed `LESSONS_FILE=implementations-plan/tob-contracts-audit/lessons/phase-N.md`; each new test or guard rule has its kill proof logged; /code-review was not run; the Codex fix loop converged for arc 1, arc 2 and the cross-arc pass, each shown by a resumed Codex pass reporting no new material findings, quoted in the transcript; the two stacked PRs and the docs-only close-out exist on GitHub, opened only after the loops converged (`gh stack view` in the transcript, and `git show --stat` of the archive-move commit), with checks green; `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:evm`, `bun run test:evm:formal`, `bun run test:evm:slither`, `bun run test:noir`, `bash contracts/aztec/scripts/compile.sh --check` and `bun run test:integration` report exit 0 in the transcript. Follow plan.md's owner decisions and Post-implementation section exactly; never merge, never run a keyed or testnet command; if a fix loop still finds material issues after 3 rounds, stop and report instead.
```

```
/loop 15m Drive implementations-plan/tob-contracts-audit forward. Never idle waiting for my input. Each firing: (1) Reality check: read plan.md and lessons/ (on a stack, from the top layer); if the plan sits under archive/ on origin/main, stop: done; if it is archived only on the stack, babysit CI until green, then stop; otherwise rebuild the task list from plan.md, `git status`, `git log --oneline -5`, PR checks if any. (2) CI in flight: watch up to 10 minutes, use the wait to review the diff. (3) No task: take the next pending step, run lint + the touched suites after each edit, commit, push. (4) A decision you would bring to me: settle it with /codex high, log it in lessons; never merge, deploy, run a keyed or testnet command, or widen scope. (5) Five failures on one step: reassess with Codex. (6) Phase gate green: paste it, mark ✓, print LESSONS_FILE; at an arc boundary run the Codex loop first, then `gh stack add`. (7) All ✓: cross-arc pass, Delivery, close-out per plan.md, `gh pr checks --watch`, report, stop.
```
