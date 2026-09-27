# Phase 10 — Full e2e + testnet build

Status: **in progress.**

## What was built

- **Specs** (`apps/web/e2e/specs/`). Each carries its `docs/assurance-map.md` cell id.
  - `deposit`: public at 1024 px `[A1][A8]`, private at 390 px `[A2][A15]`.
    - The one signed permit's token, amount, spender, nonce and deadline equal the mined router calldata.
    - A private deposit's calldata names a zero recipient.
    - The claim's submitted fee payer is the SponsoredFPC.
    - The unload guard is up while the deposit is in flight.
  - `withdraw`:
    - public exit `[A4]`
    - private deposit + private exit, both sponsor-paid `[A5][A15]`
    - finish from (tx hash, recipient, amount) with no Aztec wallet `[A14]`; a wrong amount is "not found" first
    - two tabs finishing one exit `[A13]`: exactly one portal tx, and the second tab is told
  - `recovery`:
    - signature refusal `[A11]`
    - confirm-time read failure `[A12]`
    - swallowed deposit hash → re-check finds it by log and claims once `[A11]`
    - `CONTRACT_NOT_REGISTERED` → one re-register + retry, nothing shown `[A17]`
    - an ungranted registration → the wallet refuses and the app says why `[A16]`
  - `expiry` `[A11]`, its own Playwright project that runs last because it moves L1 time: a send the wallet never answers is only re-checked. Past the permit deadline it is proven not deposited, and discard leaves nothing in flight.
- **Sidecar** (`e2e/run/funder.ts`): Fee Juice for actors that pay public ops, a public USDC balance (deposit + claim), and a public exit for the finish/two-tab specs. It uses its own anvil key, and every L2 op is sponsored.
- **Assurance map**: TS unit / integration / e2e columns filled for A1–A10, and new cells A11–A18 for the SDK↔UI properties. Every integration title now carries its cell ids.
- **Testnet build identity**: `build:testnet` writes the exact manifest string it embedded (`dist/bridge-manifest.json`), then `build/manifest-identity.test.ts` asserts it equals the committed `deployments/testnet.json`. The same test checks that the bundle's code names that manifest's node, router, portal and bridge.
- **CI**: `_e2e.yml` (`workflow_call` + `workflow_dispatch`), called from `web.yml` on the `e2e` label. The node is provisioned by `packages/local-network/scripts/install-node.sh` through the new `aztec-node` input of `setup-toolchains`:
  - no aztec-up;
  - a frozen lockfile migrated from aztec-up's own npm lock;
  - Foundry 1.4.1, sha-pinned;
  - selected via `AZTEC_NODE_HOME`, which `resolveToolchain` now honours after checking that the install holds exactly `aztecNode`.

## App changes found by the specs

- **A send the wallet never answers left the deposit at `sending` forever.** "Look for it on Ethereum" now appears during `sending` once a submission is recorded. It supersedes the hung send by epoch: a late answer from the old send is ignored, and it never re-sends.
- **Finishing a withdrawal needed both wallets.** The finish form needs only the Ethereum account; a new exit still needs both.

## Attempts

1. **Confirm-read spec failed: the deposit went through.** The spec failed the first `getPredictedMinFees` with a 503. aztec.js's node client retries a 503, so the retry succeeded and the flow signed. Fix: fail every fee read. The client gives up, and the flow aborts before signing. The unit test had covered the app logic; only the harness assumption was wrong.
2. **`[A16]` failed on the denial record format.** The app behaved correctly: the wallet denied the registration, and the app showed "Your wallet declined the permissions…". The spec expected `denied()` entries to start with `registerContract`, but the test wallet records `registration of <address>` (`test-wallet/guard.ts`).
3. **CI node from a fresh resolve.** A fresh `bun install` of `@aztec/aztec@5.0.0` matched every `@aztec/*` version but resolved 230+ third-party deps newer than the aztec-up tree the local gate runs. Migrating aztec-up's `package-lock.json` into `bun.lock` gives the same resolution. What remains differs only in hoisting, plus other-platform binaries and the unused cli-wallet.
4. **CI node: blocked `bcrypto` build.** Bun blocked three lifecycle scripts. `bcrypto`'s is load-bearing: discv5 imports its native backend at node start, and without the build `require` throws. `trustedDependencies: ["bcrypto"]` runs only that one; `protobufjs` and `unrs-resolver` stay blocked.
5. **CI node proven locally.** From a clean `node_modules`: `install-node.sh` → `AZTEC_NODE_HOME=… net:up` (the node deployed its L1 with the pinned forge 1.4.1) → `deploy:local` verified every read-back → `net:down`. The Foundry tarball's sha256 equals GitHub's recorded asset digest, and its anvil/forge are byte-identical to aztec-up's.
6. **`[A5]` timed out waiting for the Aztec tx hash, though the withdrawal had finished.** The local network proves an epoch in seconds, so the flow reached `done` between Playwright polls, and `done` hid the hash. That hash is the one detail a user must keep to finish later, so it now stays on the done screen as a record ("Aztec transaction"), and the spec reads it after `done`. A component test covers the in-flight half, which a fast local network cannot show.
7. **`[A13]`'s second tab never became clickable.** Both tabs share one browser context, so wagmi reconnected the second tab from the first tab's stored connection: "Connecting…" (disabled), then detached. `connectL1` waited to click a button that could never be clicked. It now clicks only while the status reads `disconnected`, and retries until `connected`, which is also what a real user's second tab does.

8. **Expiry never reached its verdict.** `evm_increaseTime(31 min)` then a re-check still read "not found yet".
   - **Cause.** The local node warps L1 time on its own. Each L2 block sets the next L1 timestamp about 72 s ahead (`node:eth-cheat-codes Set L1 next block timestamp`), roughly 10× wall time. The head therefore runs far ahead of anvil's clock, and so does the permit deadline, counted from the later of head and wall clock. `evm_increaseTime` moves only anvil's clock offset, so the next blocks still took `last + 1` and never passed the deadline.
   - **Fix.** `mineL1Past(deadline)` sets the next timestamp from the head, past the signed permit's own deadline. It then checks that `finalized` got there, retrying if a node warp landed first.
   - **Side effect.** Locally, a 30-minute permit lasts about 3 wall minutes, so a wallet prompt left open that long expires the deposit. That is correct behaviour, but surprising in manual testing.

Run 10a (first full run): 12 passed, 4 failed (attempts 1, 2, 6, 7), expiry skipped behind them; teardown left no registry rows or processes.
Run 10b: 16 passed, 1 failed (attempt 8); teardown clean.
Run 10c: 17/17 passed; teardown clean.
Run 10d (the CI node tree via `AZTEC_NODE_HOME`, confirmed from the node's process paths): 17/17 passed; teardown clean.

## Arc 3 codex loop

### Round 1 — session `01a0e05c-65ea-70a1-9ffd-9c48784ab4ad` (GPT-6 Astra, high), on `2c90344`

Three High, four Medium and one Low finding, each verified against the code before acting; codex reproduced most of them in memory.

| # | Sev | Finding | Verdict and fix |
|---|---|---|---|
| F1 | H | `claim()` returned as soon as the wallet did. `EmbeddedWallet.sendTx` defaults to `TxStatus.PROPOSED`, and a proposed block can be dropped, so the flow discarded the draft and its secret too early. `already-consumed` read the nullifier at `latest`. | **Accepted.** Claims wait on `L2_DONE` (`CHECKPOINTED`, 600 s), and `isClaimConsumed` reads the nullifier tree at `checkpointed`. The unit tests pin both. The private-deposit e2e checks the node's own receipt: checkpointed or later, `success`. |
| F2 | H | `sendExit` exposed the hash only after the receipt wait, so a failure after broadcast lost it and the form came back fresh: a retry burns again. | **Accepted.** The exit is sent with `NO_WAIT`, and `waitForTx(node, hash, L2_DONE)` runs inside the same try, so every post-send failure is an `ExitUnconfirmedError` carrying the hash. In the app, a send error that may have come after the broadcast (transport or unrecognised, not a simulation failure) opens the unconfirmed state with no hash: the tab stays guarded, the copy points at the wallet's activity, and only a Close (after checking) or a finish leaves. |
| F3 | H | The parsed grant never gated anything: a wallet could withhold `claim_private` and the app still marked the contracts ready and took an L1 deposit. | **Accepted.** `requestCapabilities` refuses a grant that withholds any requested contract (`missingGrants`); a wildcard grants nothing. `[A16]` now asserts the refusal lands before any call: no denial recorded, no registration attempted. |
| F4 | M | A receipt timeout released the withdraw lock while the L1 tx could still mine, letting another tab submit again (no double pay, but wasted gas). | **Accepted.** `withdrawOnL1` keeps waiting while L1 still has the tx and fails only once `getTransaction` reports it gone; any other read error counts as still known. The lock holds throughout. |
| F5 | M | Pending work was not bound to the reviewed account: switching accounts mid-deposit claimed from B for recipient A (a silent relayer path), and an exit read its account before holding the switch gate. | **Accepted.** Deposit and withdraw requests carry the reviewed account. The start refuses a changed account, a claim leaves only from the deposit's recipient (checked under the gate), and an exit reads, checks and sends under one gate hold. |
| F6 | M | The egress fence allowed every loopback port (other runs included) and could not see WebSockets or service-worker fetches. | **Accepted.** An exact-origin allowlist (the app, the wallet frames, the node), WebSockets refused and recorded, service workers blocked in the config, and a canary test proves the fence refuses another loopback port for both HTTP and WebSocket. |
| F7 | M | A labelled EVM-only PR skipped e2e through the path filter, and the status job accepted `skipped` either way. | **Accepted.** The e2e job depends on the label or dispatch alone: it deploys the contracts, so no path filter can call it irrelevant. When requested it must succeed; otherwise it must be skipped. |
| F8 | L | Both private-balance checks read the app's DOM, and `submitted()` records a tx before the node sees it. | **Accepted.** On top of the receipt check (F1), the sidecar's own wallet, which deployed every actor, reads the actor's private balance, so the app and the page's wallet take no part. The token-balance read moved into bridge-core (`l2UsdcBalance`), replacing the copies in the web app, the smoke and the integration actors. |

**Found in my own F2 fix before re-review.** `waitForTx` throws on a reverted receipt, and F2 wrapped every post-send failure in `ExitUnconfirmedError`. A reverted exit (a pause landing between the preflight and inclusion reverts the bridge's public check) discards its burn and withdraw message with the rest of its app logic, so the app would have held the user in "unconfirmed" with a hash that can never be finished and no Close. The wait now passes `dontThrowOnRevert`. A revert whose effect carries no withdraw message becomes `ExitRevertedError` ("nothing was burned"), and the form comes back. Anything else after the send stays unconfirmed. A unit row for a dropped tx was tried and removed: `waitForTx` ignores DROPPED receipts for a grace period, so the row only timed out, and "a checkpoint wait that fails" already covers that path.

**Validating round 1.**
- Unit: bridge-core 120, deployer 27, web 80 + 1 skipped. Lint, typecheck and actionlint are clean.
- Integration run 8 (`0beccc70-it-838707`): 16 pass, 0 fail, 63 expect(), 496 s, clean teardown. It ran on the round's first cut, before `ExitRevertedError` and `l2UsdcBalance`.
- Integration run 9 (`0beccc70-it-858330`, final code): 16 pass, 0 fail, 63 expect(), 500 s, clean teardown.
- Run 10e: 16 passed, 1 failed, 1 did not run (expiry waits on the bridge project); teardown clean.
  - The egress canary, the private deposit's node receipt check and `[A5]`'s NO_WAIT exit all passed live.
  - `[A16]` failed in the spec, not the app: the page showed "Your wallet declined the permissions…", but the spec still called `chooseAccountIfAsked`, which waits for a chooser that the refusal now prevents. The spec now asserts that the chooser never appears.
- Run 10f (final code): 18/18 passed in 10.0 min; teardown clean.
- Run 10g: 18/18 passed in 9.8 min; teardown clean. Two consecutive green runs on the round 1 code.

### Round 2 — same session, resumed with the `bf9f238` diff

Codex: "Not converged: two high-severity gaps remain; four additional issues need targeted fixes." Each finding was verified against the code:

| # | Sev | Finding | Verdict and fix |
|---|---|---|---|
| R2-1 | H | A checkpoint is not permanent: an epoch that misses its proof window is pruned, and the flow had already dropped the claim's secret. | **Accepted**, verified in the pinned archiver (`handleEpochPrune` unwinds unproven checkpoints once the rollup's `canPruneAtTime` allows). New bridge-core `waitClaimProven` polls the nullifier at `proven`. It returns `"dropped"` when the nullifier is not even checkpointed any more, and a failed read counts as not proven yet. The deposit flow gets a `finalizing` step: the draft and the unload guard stay until the claim is proven, and a dropped claim is claimed again from the kept ticket. The stepper gains "Proven". The integration spec pins the `proven` tag on the real node; the e2e receipt must now be proven or finalized. |
| R2-2 | H | `mayHaveSent` was a denylist over presentation categories: "No provider: wallet connection lost" (`no-wallet`) and any `/revert/` text reopened the form after a possible broadcast. | **Accepted.** It is inverted into an allowlist, `surelyUnsent`, covering only an explicit rejection (typed), a refused permission, an ACVM `Assertion failed` (private execution aborts before proving) and `ExitRevertedError`. Everything else stays unconfirmed. The copy now also sends the user to their balance after a few minutes, since an empty wallet-activity list is not proof. |
| R2-3 | M | A missing tx effect became `[]`, so a reverted receipt plus no effect read as "nothing burned". | **Accepted.** A missing effect throws inside `locateExit`, so the exit stays `ExitUnconfirmedError`. |
| R2-4 | M | One `TransactionNotFoundError` released the withdraw lock; one backend of a load-balanced RPC can miss a live tx. | **Accepted in part.** The lookup already came only after 8 × 90 s receipt waits plus a mined-receipt probe. The withdraw now needs two consecutive misses one full round apart; a found tx resets the count. Waiting forever, as codex proposed, was rejected: it pins a tab on a truly dropped tx. The residual (a private-relay tx invisible for about 25 min) costs gas at most, since a resend fails the Outbox nullifier in simulation or on-chain. |
| R2-5 | M | The switch gate spanned proving and the L1 settlement, which blocks an account switch for up to an hour and can deadlock against a deposit's `#claimant`. | **Accepted.** `#burn` runs under the hold (check, preflight, send); `#finishTicket` runs after it is released. Fee fallback is changed the same way. |
| R2-6 | M | `missingGrants` checked only the registered contracts: a dropped `AuthRegistry.set_authorized` scope or `canCreateAuthWit: false` passed. | **Accepted.** It now checks scopes on contracts the app never registers and every `true` flag of the accounts and contracts capabilities (`GrantedAccountsCapability` extends the request, so the flags are echoed). The fake provider now echoes them, as a real wallet does. |

**Found while checking R2-6 against A16.** The app requested `canGetMetadata` but never calls `getContractMetadata` or `getContractClassMetadata`, and the test wallet did not gate those calls, so the suite could not have caught one. Under the stricter flag check, a wallet that withheld the flag would have been refused for a permission the app does not use. The flag is gone from the request, and the test wallet now refuses both metadata calls without it; a later e2e run is the proof that nothing needs them.

**Validating round 2.**
- Unit: bridge-core 121, web 90 + 1 skipped. Lint and typecheck are clean.
- Integration run 10 (`0beccc70-it-909640`): 16 pass, 0 fail, 64 expect(), 477 s, clean teardown. The new `proven` read passed on the real 5.0.0 node.
- Run 10h (before the `canGetMetadata` change): 18/18 in 10.0 min; teardown clean. The deposit specs now wait for the proven claim.
- Run 10i (final code, `canGetMetadata` dropped and metadata calls gated): 18/18 in 9.8 min; no denial recorded; teardown clean.
- Run 10j: 18/18 in 10.4 min; teardown clean. Two consecutive green runs on the round 2 code.

### Round 3 — same session, resumed with the `464d32c` diff

Codex: "Not converged: three high-severity safety gaps remain, plus one medium-severity timing defect." This is the third round with material findings, so per plan.md's Post-implementation rule ("Still material after 3 rounds → stop and surface to the user") the loop is **held for the user**. Assessment of each finding:

| # | Sev | Finding | Assessment |
|---|---|---|---|
| R3-1 | H | `proven` is not final either: an L1 reorg can remove a proof that landed near its deadline, and the epoch becomes prunable after the secret is gone. | Valid, and the fix is cheap: wait for `finalized` (L1 finality, roughly 13 more minutes with the tab open) and keep the checkpointed "dropped" check. |
| R3-2 | H | The unsent allowlist still trusts wallet text. The wallet-sdk wraps every wallet error as `new Error(jsonStringify(error))` (verified, `extension_wallet.ts:211`), so an "Assertion failed" or capability text after a broadcast reopens the form. `isUserRejection` also matches wording. | Valid. This is a UX trade-off, so it goes to the user: the strict fix also shows "may have been sent" after a plain wallet "Reject". |
| R3-3 | H | The "unchanged balance and empty activity → withdraw again" copy is unsafe while the first exit is still pending; two distinct burns are two withdrawals. | Valid. Both exits pay the same recipient, so nothing is lost, but the first needs its hash. The copy must disclose the duplicate risk rather than imply a safe retry. |
| R3-4 | M | Two receipt rounds are not about 25 minutes: immediate RPC failures skip the 90 s timeouts (reproduced as 32 s), and "Nothing was paid" overstates. | Valid: enforce a minimum elapsed time since the send, and use an uncertain verdict. Codex agrees the duplicate L1 send is gas-only. |

**Round 3 fixes**, after the user said "fix + keep going on rounds until satisfied, but don't over-engineer", and chose to trust a wallet rejection only:
- R3-1: `waitClaimFinalized` reads the nullifier at `finalized`, keeping the checkpointed "dropped" check; the stepper's last step is "Final". Local anvil runs `--slots-in-an-epoch 1`, so finality is only a few L1 blocks behind the head.
- R3-2: `surelyUnsent` is `ExitRevertedError` or `isUserRejection` only. The user's rationale: a wallet that lies about a rejection already holds the keys. Capability and assertion texts now stay unconfirmed.
- R3-3: the copy no longer implies a safe retry. It points at the wallet's activity and says plainly that withdrawing again can make two withdrawals, both the user's, the first finishable only by its own hash.
- R3-4: "gone" also needs 30 minutes since the send, and the verdict says "most likely dropped… if the first still lands, the second fails and costs only gas".
- Validation: unit (bridge-core 121, web 90 + 1 skipped), lint and typecheck clean; integration run 11 (`0beccc70-it-978138`) 16/16, where the `finalized` read passed on the real node; runs 10k (11.5 min) and 10l (11.3 min) 18/18 each, clean teardown.

### Round 4 — same session, resumed with the `ffccfa6` diff (plan's no-over-engineering rule restated verbatim)

Codex: "No new material findings." The Arc 3 loop has converged, one round past the plan's cap, as the user authorized.

## Final cross-arc pass (codex, fresh session over `a44f425..HEAD`)

Session `01a0e2ec-938c-7231-9c9e-3e3f27f49209`, GPT-6 Astra at `high`, both plan rules verbatim. Round 1: "Not converged: three cross-arc correctness gaps remain, plus two targeted documentation fixes."

| # | Sev | Finding | Verdict and fix |
|---|---|---|---|
| X1 | H | After the first receipt, `retryClaim` and the prune path reuse the ticket. An L1 reorg that re-mines the deposit at another Inbox index leaves the UI claiming a stale leaf forever. | Confirmed: both paths called `#claimWhenReady` with the kept ticket. Both now go through `#recheck()`, which reconciles the draft on Ethereum for a fresh ticket and keeps the pending and not-deposited handling. |
| X2 | M | The browser never calls `assertNetworkIdentity`, and every production `assertSigningContext` passes `null` for the Aztec wallet, contradicting the plan's Network identity row and A12. | Confirmed (the only callers were deployer `verify`/`smoke`). A web `assertNetwork` op runs both, the latter with the Aztec wallet and the selected accounts, inside the deposit's confirm-time reads and the withdrawal's preflight. Claims need no L1 and stay unchanged. |
| X3 | M | The testnet smoke dropped the claim ticket at a checkpoint, the arc 2 consumer the arc 3 finality fix never reached. | Confirmed. `finalizeClaim` keeps the ticket until `waitClaimFinalized` says "finalized", and on "dropped" reconciles and claims again. |
| X4 | L | The approval copy named only a Permit2 flaw, not a signature given to a malicious site; the private copy did not say a wallet may ignore the sponsor; "until … claimed" undersold finality. | One sentence each, and "until the claim is final". |
| X5 | L | The `claim` doc said a caller may discard the secret on "already-consumed"; `claim_secret/lib.nr` cited a nonexistent `private-fuel.ts` and a separator assertion the test does not make; `main.nr` narrated its entrypoints. | Doc now requires `waitClaimFinalized` for both outcomes; the Noir comments keep only the invariants. `check-sole-consumer.sh`'s self-test anchored on a deleted narration comment, so it anchors on `exit_to_l1_public`'s attribute instead. `compile.sh --check`: class id and ABI unchanged. |

Validation: sole-consumer check and self-test (15 mutants) green; `compile.sh --check` and `test:noir` green; unit (bridge-core 121, web 93 + 1 skipped, deployer 27, local-network 14), lint and typecheck clean. Run 10m: e2e 18/18 in 11.4 min, clean teardown; the deposit specs pass the new browser identity check against the real node and anvil.

Round 2 (resumed, `151a3a5`): "Not converged: one material gap remains in smoke finalization." After a prune, `reconcileDeposit` reads an RPC failure as "pending", and the smoke threw on it, losing the only ticket; a failed re-claim did the same. Valid. `keepUntilFinal` (injected steps, so it is unit-tested) retries "pending" and a failed re-claim a minute apart and gives the secret up only on a proven "not-deposited". Codex agreed the browser reconciliation and doc fixes resolve their findings. Deployer 29 pass, lint and typecheck clean.

Run 10n (the `151a3a5` web code; `30b948f` touched only the deployer): e2e 18/18 in 11.4 min, clean teardown, the second consecutive green run.

Round 3 (resumed, `30b948f`): "No new material findings." The final cross-arc loop has converged.

## /harden security on contracts/ (after the cross-arc pass)

Effort `high`, run `2026-09-27-contracts`. Scope was `contracts/` only (D16). The report is kept local in `audit/security/2026-09-27-contracts/` (`audit/` is in `.git/info/exclude`) and was not published: a security inventory is not published without the user's say-so.

- **Shape:**
  - Phase 1: Sonnet repo map.
  - Phase 2: four clusters (L1 portal and router, L2 bridge and minter, the L1↔L2 message seam, build and supply chain), each audited by Claude Sonnet and Codex GPT-6 Astra at xhigh.
  - Phase 2.5: light cross-rebuttal.
  - Phase 3: Fable coordinator.
  - Phase 4: driver plus a fresh Codex verifier.
- **Result:** 0 Critical, 0 High, 1 Medium, 0 Low. C1–C3 are zero from both families, independently traced to the aztec-nr macros and the vendored Inbox/Outbox; the residual risks are the plan's accepted and deferred ones, and the code still matches them.
- **F-001 (Medium, fixed):** `compile.sh` built deployable Noir artifacts without running `noir-deps.sh`, and nargo clones a mutable tag on a cache miss without checking its commit. The deployer imports the working-tree artifacts, and `deployer verify` is circular on provenance, so a retargeted upstream tag could reach a local build and then a deploy. CI verified first, so only the local path was exposed.
  - Codex raised it. Claude missed it (it assumed CI's `--exact` backstopped deploys), then converged in rebuttal.
  - Fix: `compile.sh` runs `noir-deps.sh` before compiling.
- **Verifier pushback:** Codex first raised a residual, index flags hiding an edited cache entry from `git status`. The driver pushed back: a process that can write `~/nargo` runs as the user and can replace the toolchain binary, overwrite git objects, or plant a clean filter or `core.fsmonitor`, so a git-based check cannot stand against it. Codex: "Agree: insertion only." `noir-deps.sh`'s header now states that limit.
- **Not applied:** the coordinator's defence-in-depth deployer check (refuse artifacts that differ from HEAD). No concrete path remains, and it would be an extra layer.
- **Also fixed:** the `claim_secret` separator comment now names both keystone tripwires (Noir: FPC fuel; TS: protocol secret hash).
- **Validation:** shellcheck clean; `noir-deps.sh --self-test` passed; `compile.sh --check` passed, printing "5 entries fetched + verified" first, with both class ids unchanged, so no contract bytes moved and the redeploy chain does not apply. Lint clean.
