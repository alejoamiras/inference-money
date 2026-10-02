# Phase 4: the Presto spec, CI and docs

## Built

- `apps/showcase/e2e/specs/presto.spec.ts`, one test in five steps: the page loads and reaches nothing on the visitor's machine (the ribbon asks; its text computes to Figtree Variable, which loads from the page's origin under the CSP: I5); Connect and the browser's grant connect Presto; a send proves there (`POST /prove` 200, "Prove · Presto"); after `clearPermissions()` a send proves in the page and the page sends nothing toward either Presto origin; re-granted, the ribbon plays its connected morph and hides, then with the proxy stopped a send proves in the page and HTTP carries nothing but `GET /health`.
- `.github/workflows/_e2e.yml`: a `presto` job beside `e2e` (same toolchain setup, `bun run test:e2e:presto`, its own failure artifact; the key and presto-server's home are outside the uploaded dir).
- Docs: `AGENTS.md` (the command, presto-server in the version rule, the showcase row), `docs/architecture.md` (Presto, the CSP), `docs/ci-pipeline.md` (the job).

## Attempts

1. First Presto run: 4/4 passed (the spec in 51 s: one native proof including presto-server's first bb download, two browser proofs).
2. First main-suite run, concurrent with it: stopped at the bundle check. The fake-proof build held both Presto chunks. Rolldown had dropped the dead `import()` calls behind `PROVES` but still emitted their targets as chunks that nothing references. The page can never load them, so the check now follows static and dynamic imports from the entry (what the page can load), and the two comments that claimed a fake bundle carries nothing now say the page never loads it. Verified on the kept fake bundle (Presto unreachable) and the testnet bundle (reachable).
3. Re-runs, started together: the Presto suite passed 4/4; the main suite died claiming ports with `ports.md.lock is held by pid …, which is no longer running`, while the lock file was already gone. That is a race in `packages/local-network/src/registry.ts` `tryLock`: it reads the holder, the holder releases and exits, then the liveness check calls it dead. Pre-existing and outside this plan: logged as a follow-up, the suite re-run on its own.

## Findings

- A fresh presto-server home holds no bb, so the first check reads `downloading` (connected, fetching this Aztec version's prover) rather than `available`; the spec accepts either at Connect and asserts the connected morph at the reconnect, once bb is cached.
- The Connect click and the grant race in the test (no prompt to wait on); both orders end connected, through `connect()` or the permission watch.
- Headless Chromium reports `ERR_CONNECTION_REFUSED` once the proxy stops, and the SDK falls back without any HTTP `/prove`.
