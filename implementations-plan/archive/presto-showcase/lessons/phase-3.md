# Phase 3: the product

## Built

- `src/presto/proofs.ts`: per-proof attribution (`transmit` → on its way to Presto, `fallback` → the browser), credited when the wallet's proof call settles; a failed proof is credited to nothing.
- `src/presto/prover.ts`: one `PrestoProver` per page with the page's `WASMSimulator`, forced local at construction.
- `src/presto/consent.ts`: the SDK README's `askBeforeConnecting`, adapted: a `view` observable, `stop()` (forces local, drops the guard, unsubscribes, bumps the epoch so a check in flight is dropped), and `beforeProving` installed as the prover's guard.
- `src/presto/PrestoRibbon.tsx` + `ribbon.css`: the official ribbon, `theme="light"`, `fonts="none"`, Presto's faces self-hosted through `--pb-font-display` / `--pb-font-body`.
- `src/presto/index.ts`: `pagePresto`, the module `start.ts` imports dynamically on real-proof builds only.
- `demo/wallet.ts`: the PXE proves through the page prover and shares its simulator; each `proveTx` runs inside `around`.
- `live/useLivePresto.ts`: the consent lives while "Try it yourself" is mounted.
- `ui/Layout.tsx` (`notice` slot above the composer), `live/LiveMode.tsx` (ribbon, hint), `live/useLive.ts` (per-run proof state, the Presto working copy), `ui/Verdict.tsx` ("Proving with Presto", "Prove · Presto").
- `build/bundle.test.ts`: nothing the page loads first comes from Presto; a bundle carries Presto exactly when its CSP lets it reach Presto.

## Decisions while building

- **Credit on settle, not on `proved`.** presto-core emits `proved` and `receive` before `PrestoProver` decodes the body, and a body that fails to decode falls back to WASM after them. Crediting at `proved` would briefly label a browser proof as Presto's.
- **Per-run proof state.** `useRun` resets it at each run's start and listens only during the run, so a run that proves nothing (a refusal, a replay) never shows an earlier run's "Prove · Presto".
- **Ribbon built outside React.** React 19 assigns a JSX prop as a property when the custom element defines one; `PrestoBanner.variant` is getter-only, so `<presto-banner variant="ribbon">` would throw once the element is registered. The element also links Google Fonts in `connectedCallback` unless `fonts="none"` is already set. So it is created with `document.createElement`, attributes set, then appended. This also makes a JSX intrinsic-element declaration unnecessary.
- **Consent complexity.** The upstream `apply` scored 17 under Biome's cognitive-complexity rule once nested in the factory; its decision rule moved to a top-level `follow()`, the rest keeps upstream's statements.
- **No simulator dedupe.** Built `build:testnet` without one: it resolves (one copy in the store, reached through Bun's hoisted fallback), and the page passes its own simulator, so the SDK's lazy `import("@aztec-labs/simulator/client")` never runs.

## Mutation checks (scratchpad, not committed)

- Guard never installed → killed (unreported revocation test).
- `stop()` without `setForceLocal(true)` → killed (unmount test).
- `useRun` without the per-run reset → killed (LiveMode chip test).
- Fallback ignored in attribution → killed (attribution table).
- Removing the first epoch check in `check()` survives: the next statement re-reads the permission, which still reads denied, so proofs stay local either way. The epoch only keeps a stale status off the ribbon there; the tested property (no native proving after a revocation) does not depend on it.

## Gate

`bun run lint && bun run typecheck && bun run test` exit 0 (showcase: 17 files, 84 passed, 5 skipped); `bun run --cwd apps/showcase build:testnet` exit 0 (bundle and manifest-identity: 7 passed). Presto lands in two lazy chunks (`presto-*.js`: SDK, consent, prover; `PrestoRibbon-*`: banner, CSS, five woff2 faces).

LESSONS_FILE=implementations-plan/presto-showcase/lessons/phase-3.md
