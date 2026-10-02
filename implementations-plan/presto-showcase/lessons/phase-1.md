# Phase 1: build target, CSP and dependencies

## Done

- `BuildTarget.presto` (`apps/showcase/build/target.ts`): the app's ports (59833 HTTP, 59834 HTTPS) unless a local build sets `PRESTO_PORT` / `PRESTO_HTTPS_PORT`; a testnet manifest refuses either; values must be integers 1–65535 and differ. `cspFor` adds `https://127.0.0.1:<httpsPort>` and `http://127.0.0.1:<port>` to `connect-src` for real proofs only. `__SHOWCASE_PRESTO__` defined in `vite.config.ts` and `vitest.config.ts`.
- `e2e/testnet/live.spec.ts` builds its expected headers with `PRESTO_DEFAULT`, so the served-headers check ([A29]) covers the new CSP.
- Dependencies: `@alejoamiras/presto@6.0.0-rc.1`, `@alejoamiras/presto-banners@1.2.0`, `@aztec-labs/simulator@6.0.0-rc.1`, `@fontsource-variable/{bricolage-grotesque,figtree}@5.3.0`.

## The 7-day gate applies only at resolution

- Attempt: added `minimumReleaseAgeExcludes = ["@alejoamiras/presto", "@alejoamiras/presto-core", "@alejoamiras/presto-banners"]` (presto-banners 1.2.0 was also under seven days: 2026-09-25 21:40 UTC), `bun install` → resolved and locked.
- Question: does `bun install --frozen-lockfile` re-check the age of locked versions? A run with `node_modules` present proved nothing ("no changes").
- Test: copied the tree without `node_modules`, `BUN_INSTALL_CACHE_DIR=<empty dir> bun install --frozen-lockfile --ignore-scripts` with the exclusion removed → exit 0, 707 packages, `@alejoamiras/presto*` installed.
- Outcome: `bunfig.toml` keeps no exclusion, following its own "remove the entry in the same PR" rule. A later bump of these packages passes the gate like any other.
- Side note: a `grep -v minimumReleaseAgeExcludes` to strip the lines also removed bunfig's "CVE bypass" comment, which names the key; restored from HEAD.

## Gate

`bun install --frozen-lockfile` (exit 0), `bun run lint` (exit 0), `bun run typecheck` (exit 0; first run caught the live spec's `BuildTarget` literal), `bun run --cwd apps/showcase test:components`: 14 files passed, 1 skipped; 70 tests passed, 4 skipped.
