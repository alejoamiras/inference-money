# Phase 4: the Presto spec, CI and docs

## Built

- `apps/showcase/e2e/specs/presto.spec.ts`, one test in five steps: the page loads and reaches nothing on the visitor's machine (the ribbon asks; its text computes to Figtree Variable, which loads from the page's origin under the CSP: I5); Connect and the browser's grant connect Presto; a send proves there (`POST /prove` 200, "Prove · Presto"); after `clearPermissions()` a send proves in the page and the page sends nothing toward either Presto origin; re-granted, the ribbon plays its connected morph and hides, then with the proxy stopped a send proves in the page and HTTP carries nothing but `GET /health`.
- `.github/workflows/_e2e.yml`: a `presto` job beside `e2e` (same toolchain setup, `bun run test:e2e:presto`, its own failure artifact; the key and presto-server's home are outside the uploaded dir).
- Docs: `AGENTS.md` (the command, presto-server in the version rule, the showcase row), `docs/architecture.md` (Presto, the CSP), `docs/ci-pipeline.md` (the job).

## Attempts

1. First Presto run: 4/4 passed (the spec in 51 s: one native proof including presto-server's first bb download, two browser proofs).
2. First main-suite run, concurrent with it: stopped at the bundle check. The fake-proof build held both Presto chunks. Rolldown had dropped the dead `import()` calls behind `PROVES` but still emitted their targets as chunks that nothing references. The page can never load them, so the check now follows static and dynamic imports from the entry (what the page can load), and the two comments that claimed a fake bundle carries nothing now say the page never loads it. Verified on the kept fake bundle (Presto unreachable) and the testnet bundle (reachable).
3. Re-runs, started together: the Presto suite passed 4/4; the main suite died claiming ports with `ports.md.lock is held by pid …, which is no longer running`, while the lock file was already gone. That is a race in `packages/local-network/src/registry.ts` `tryLock`: it reads the holder, the holder releases and exits, then the liveness check calls it dead. Pre-existing and outside this plan: logged as a follow-up. The suite re-run on its own passed 7/7.

## Findings

- A fresh presto-server home holds no bb, so the first check reads `downloading` (connected, fetching this Aztec version's prover) rather than `available`; the spec accepts either at Connect and asserts the connected morph at the reconnect, once bb is cached.
- The Connect click and the grant race in the test (no prompt to wait on); both orders end connected, through `connect()` or the permission watch.
- Headless Chromium reports `ERR_CONNECTION_REFUSED` once the proxy stops, and the SDK falls back without any HTTP `/prove`.

## Codex fix loop

### Round 1 (GPT-6 Astra, high; session `01a0fd76-b632-7362-a938-4a78aba3b885`): request changes, 6 findings

1. Medium, a grant queued behind an in-flight check probes after `stop()` (`stop` left `consented` true). **Accepted**: `stop()` clears the choice, `check()` starts nothing once stopped; regression test (fails on the old code).
2. Medium, force-local cannot cancel an SDK operation already under way (a proof in detection can still POST after `stop()`). **Rejected as out of scope**: cancelling needs a change and a release of the SDK. The browser's permission still gates every request, and the guard decides at each proof's start; `stop()`'s contract and `docs/architecture.md` now say a proof already under way finishes where it started.
3. Low, overlapping consents erase each other's guard. **Accepted, minimal**: `guard()` returns a remover that clears only its own check; `stop()` is idempotent. Unreachable from the app today (StrictMode cleans up before it sets up).
4. Medium, after a fallback the hint keeps "by Presto" and the ribbon its connected state. **Accepted**: a proof that falls back runs one status check, so the ribbon shows why and the hint, which follows the last check, says "in this browser"; the spec's step 5 asserts both.
5. Medium, `stop_group` dropped the sidecar's final ownership check before SIGKILL. **Accepted**: restored.
6. Low, comments. **Accepted**: three narrating comments removed, the historical "Design F" label dropped, the ribbon's doc condensed, and `around()` documents that calls must not overlap.

### Round 2 (resumed): no new regression; round-1 #4 still open, one wording finding

1. Medium, the hint still names Presto after a fallback when `/health` keeps answering (an undecodable proof, a transient `/prove` failure). **Accepted**: the hint no longer reads availability. With any status (the visitor connected) it says "proven by Presto when it can, else in this browser", always true; otherwise "proven in this browser". The re-check's comment no longer claims `/health` explains a failure. The spec asserts both hints (revoked; after the fallback).
2. Low, "finishes where it started" overpromises: a native attempt can still fall back or fail. **Accepted**: `stop()` "does not cancel SDK work already under way"; the module comment and `docs/architecture.md` speak of later proofs.

### Round 3 (resumed): converged

"No new material findings — both round-2 fixes are verified; confidence: high." No findings; no comment changes warranted.

## Gate

`bun run test:e2e` exit 0 (7 passed, 2.7 min, fake-proof bundle: Presto unreachable); `bun run test:e2e:presto` exit 0 (4 passed: the three infra specs and the Presto spec in 50 s); `bun run lint:actions` exit 0.

LESSONS_FILE=implementations-plan/presto-showcase/lessons/phase-4.md
