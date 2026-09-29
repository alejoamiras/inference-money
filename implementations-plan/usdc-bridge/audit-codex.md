# Codex audits — usdc-bridge

## Round 1 — plan audit (gpt-6-astra, high)

Session `01a0d96d-1622-7a83-8b6f-4425352ae001`. Verdict: **reject (with blocking findings: unsafe inherited L2 initialization, incomplete in-memory recovery, unproven wallet privacy and network compatibility)**. P = plan.md, R = recon.md; historical paths are nulo.

**Critical** — none conclusively established (plan audit; router not yet written).

**High**
1. *Universal deployment permits L2 initializer takeover.* `4df5eae5:packages/bridge-core/scripts/deploy-bridge-testnet.ts:234` deploys with `universalDeploy: true`; `token_minter_proxy/src/main.nr:26` and the bridge set owner from `msg_sender()`; aztec-nr v5.0.1 `initialization_utils.nr:159` accepts any initializer when deployer is zero → an attacker initializing first seizes bootstrap authority or the pause lever. Fix: bind proxy/bridge deployment to the intended nonzero deployer; verify owners and initialization before wiring; test attacker-first initialization.
2. *A receipt failure loses funds without a reload.* The claim ticket only exists after `runDeposit` completes; the verbatim `l1-receipt.ts` terminal error promises retry from a journal-recorded tx. `depositWitnessTypedData` takes neither the secret hash nor a prepared ticket. Fix: create the in-memory deposit draft (secret/salt, recipient, exact witness) before signing; attach the broadcast hash immediately; keep it through receipt/log failures, cancellation, wallet disconnect; reconcile, never silently redeposit; test mined-deposit + receipt timeout.
3. *"SponsoredFPC fixes the privacy leak" is unproved at the wallet boundary.* The freeze test wallet registers SponsoredFPC and customizes fee routing (`6611f861:apps/tools/tests/browser/test-wallet/wallet.ts:54,149`), so it cannot establish another wallet's behavior; a sponsor can drain after preflight. Fix: qualify supported wallet/version combos via their real submission path, inspect the submitted payer, block or require informed fallback before submission; test sponsor exhaustion and wallet override.
4. *Compatibility is a late, product-killing gate.* Mixed-version proof waits for Phase 10; the Permit2/Circle fork test and the fake-rollup Outbox don't exercise the deployed 5.0.0 Inbox/Outbox. Fix: compatibility spike against the exact target early; extend fork gate to deployed messaging; a 5.2.0 local network can't discharge it.

**Medium**
5. *Network identity/deploy verification incomplete.* chain id + version don't authenticate a rollup; `TOKEN = portal.underlying()` trusts the portal. Fix: bytecode vs artifacts; full binding (registry/rollup/inbox/outbox/version, portal token/bridge, bridge proxy/portal, proxy token/bridge/owner, token minter/auth/decimals); require initialized nonzero deps before router deploy; re-check wallet account/chain at every signing/sending boundary.
6. *Private bridge amounts are public on L2 too.* aztec-standards v5.0.1 `main.nr:449,489` emits public supply `Transfer` events with amounts; private mint/burn enqueue them (672/692). Fix: separate recipient privacy from amount privacy in copy.
7. *Phishing description conflates attacks.* With `owner = msg.sender`, a stolen router signature is unusable; the viable attack is a signature naming an attacker spender against the unlimited Permit2 allowance. Fix: distinguish the attacks; exact approval by default or explicit unlimited choice; say the private commitment is opaque in typed-data displays; CSP can't authenticate a clone.
8. *Capability map picks an incomplete predecessor.* `buildBridgeManifest` omits `STANDARD_AUTH_REGISTRY_ADDRESS.set_authorized` (present in `buildCombinedManifest`). Fix: extract needed scoped grants incl. claim simulation; test against enforcing capabilities.
9. *Withdraw assumes message position.* `l2ToL1Msgs[0]` (`flows.ts:219`). Fix: compute the expected message, locate its index, reject mismatch; test extra messages, delays, reorg, already-consumed.
10. *Supply-chain/secret gates overclaim.* Remote tag resolution after compile doesn't authenticate cached contents; `git grep` for keys leaks via argv and misses untracked files. Fix: validate fetched dep trees (incl. transitive) before compile, clean-cache CI; in-process boolean secret scan; ephemeral deploy wallet/PXE; scrub secret env from child processes.

**Low**
11. *Gate inconsistencies.* Router balance "always 0" is wrong (donations) — assert "unchanged"; Halmos optional contradicts "formal"; add witness mutation/replay/domain tests (matching literals can duplicate one mistake).

**Assumptions** — Facts: exit data is public, so "withdrawal unrecoverable" is false — say "the app provides no recovery"; "shipped pairing" is provenance, not interop proof. Inferences: sponsor presence, wallet behavior, version compat, 60-min proof bound unverified; timeouts must keep state; exact-pull covers user→router only. Asks: supported third-party wallets, privacy fallback, early testnet credentials, pause-key custody ("throwaway" conflicts with an incident lever).

**A vs B** — prefer A with fixes; keep the proxy; B is internally inconsistent (owner-gated setter + "no owner"); keep package boundaries; type `L1Port` operations (no `unknown`) and keep the direct receipt probe; avoid duplicate manifest definitions.

**Looks right** — immutable portal/token, ownerless router, zero private recipient, recipient-derived secrets, exact approvals with reset, real-Outbox replay tests, porting from core not Vue.

## Final fresh-context pass — round 1 (gpt-6-astra, high)

Session `01a0d999-cad9-72c0-aa60-29ba08de9949`. Verdict: **reject (with blocking findings: incomplete deposit reconciliation and unsupported hash-only private-exit recovery)**.

- **H1** "Finish a withdrawal" cannot rebuild a private exit from its hash alone — `l2ToL1Msgs` are hashes (`v5.0.0 tx_effect.ts:56`); the recipient/amount are hashed in-circuit (`token_bridge/src/main.nr:150` @V1). Fix: tx hash + recipient + amount; recompute and verify inclusion; test after destroying app memory with a non-default recipient.
- **H2** `DepositDraft` only reconciles once the wallet returns a hash; broadcast-then-lost-response has no identifier; replacements unspecified. Fix: record account/network/start block pre-send; bounded router-log lookup by depositor + secret hash + intent, authenticating the emitter; handle replacement/cancellation; test lost response.
- **M3** Noir dep check: an empty cache validates nothing; matching HEAD ≠ unmodified tree. Fix: explicit fetch, tree validation, compile from verified cache; missing-cache + modified-source tests.
- **M4** Phase 6 can't prove proof acceptance — local network settles synthetically, `realProofs` false (`v5.0.0 local-network.ts:127`; freeze `sandbox/l2.ts:88`). Fix: real-proof acceptance gate or make Phase 7 explicitly that gate.
- **M5** Ephemeral wallet/PXE requirement dropped; V1 embedded wallet defaults to disk. Fix: ephemeral + cleanup; define scanner scope/exclusion; dummy-secret tests.
- **M6** `/harden` remediation after deploy can leave the app on obsolete contracts. Fix: redeploy/re-smoke/rebuild when bytes change; verify final manifest vs final artifacts.
- **M7** Identical withdrawals → identical hashes; stdlib witness helper rejects ambiguity without an index; reorg test dropped. Fix: carry occurrence index; test identical, delayed roots, consumed, reorg rebuild.
- **L8** Injected transport removes app-controlled egress, not RPC disclosure. Fix wording; test unsupported methods/disconnect.
- Assumptions: hash-only recovery false; interface diff ≠ proof compat; probe facts time-sensitive; non-zero sponsor ≠ sufficient; D6 "settled" vs open Ask 3.
- Verified fixed: deployer-bound deploys + owner checks; best-effort privacy policy; SponsoredFPC fee path + early probe; wiring verification, signing fences, privacy/phishing copy, enforcing capabilities, constructor guard; one viem, acyclic integration, injected transport; proxy + ownerless router.

## Final pass — round 2 (resumed)

Verdict: **reject (reconciliation can falsely declare a mined deposit absent)**. H1: scan lower bound = current block misses a deposit re-mined below it after a reorg; a known-but-replaced hash must not suppress the log scan; "not-deposited" only after a complete scan through a finalized block with timestamp > permit deadline (Permit2 checks block.timestamp). M2: no occurrence-selection rule for identical messages; test two identical messages in ONE tx. M3: the stdlib witness helper throws on root mismatch / returns undefined on a missing root during construction, before simulation. M4: the proof spike's random key contradicts the no-key-creation rule — authorize it explicitly.

## Final pass — round 3 (resumed)

Verdict: **approve**. No remaining material findings (confidence high). Verified fixed: finalized lower bound + always-scan + complete-scan-before-absence; occurrence selection with `all-consumed`/`not-found` and same-tx duplicate test; bounded rebuild around witness construction, missing root → pending; spike key narrowly authorized, operational keys still prohibited. Remaining risk lives in the validation gates (mixed-version bridge compatibility, sponsor funding, wallet fee behavior); product asks remain open for the user.

## Final pass — round 4 (resumed; v5 delta: V2 QA port, D19 guards, D20 claims+exits pause, D21, D22)

Verdict: **reject**. M1: class-id parity misses public ABI corruption (renaming `claim_public` in the JSON left the class id unchanged; `artifact_hash.ts` excludes public ABI entries) → add normalized SDK-facing ABI parity + mutation regression. M2: `noir-deps.sh` compiled before `compile.sh --check`, whose baseline is working-tree artifacts → fetch/verify only, `--check` is the sole compile against HEAD. M3: the D19 payout check is a portal-debit check; a USDC self-transfer never debits, so an exit to the portal is unwithdrawable → refuse zero/portal recipients in `exitToL1` before burning. L4: re-read `is_paused` at confirm and after the Permit2 signature. L5: Web Lock lifetime (non-waiting, recheck inside, hold through receipt). L6: D22 premise false — V2's `_bridge-contracts.yml` runs TXE (driver-verified). Verified: D19 preserves hash preimages and atomic rollback incl. blacklisted recipients; halmos 0.3.3 implements TLOAD/TSTORE; the 14 TXE properties fit V1's existing guards. All six adopted.

## Final pass — round 5 (resumed)

Verdict: **approve**. All six r4 fixes are specific and consistent across mechanics, gates and ledger; no new contradiction (confidence high).
