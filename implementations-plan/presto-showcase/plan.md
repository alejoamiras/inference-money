---
plan: presto-showcase
tier: light
driver: claude-code
eli5_mode: artifact
code_review: off
claude_model: n/a (light tier has no Claude leg)
harden: not scheduled (owner's Phase 0 answer)
budget: recon 2 agents; one Codex plan audit; Codex fix loop after implementation
status: approved by the owner 2026-10-02 (approve; A1 accept, A2 keep, A3 Presto's own fonts)
---

# Presto in the showcase

The live showcase ("Try it yourself", `#live`) proves every transaction in the visitor's browser: 7–21 s per proof. [Presto](https://presto.build) proves natively on the visitor's machine. This plan wires Presto into the showcase the way Presto documents it: the official `<presto-banner variant="ribbon">` above "Inside the wallets" asks before anything reaches the visitor's machine, Connect switches the page's prover to Presto, and every failure falls back to the browser as today.

**Phase 0 decisions (owner, 2026-10-02):** the official Ribbon (not a custom banner); `@alejoamiras/presto` exempt from the 7-day npm gate; e2e proves through a headless `presto-server` behind an HTTPS proxy in the test; no `/code-review`, no `/harden`; tier `light`.

## Outcome & Quality Bar

**For whom.** A visitor on the testnet showcase in desktop Chrome or Firefox, often someone the owner shows the demo to, who may or may not have Presto installed. Second, the owner as Presto's author: the showcase becomes a reference integration of their SDK and banner.

**What excellent looks like.**
1. Nothing reaches the visitor's machine until they press Connect, or their browser already allows this site to reach apps on the device; after the browser reports a revocation, the page sends nothing new. The ribbon explains the browser's permission prompt before it appears.
2. The page never claims a proof ran on Presto unless that proof completed there: the Prove chip says "Presto" only after a native proof finished without a fallback, and the working copy names Presto only while a proof is actually on its way there.
3. Every Presto failure (not installed, blocked, HTTPS needs fixing, version mismatch, error) leaves browser proving working exactly as today, with the ribbon's own state for it.
4. A maintainer can read the integration against Presto's README section "Ask before you probe" and find each of its six steps.

**Good enough.** The ribbon keeps Presto's colours and fonts, self-hosted (no Google Fonts); no timing readout beyond the Prove label; no HTTP-proving consent UI; the proving harness stays browser-only and is not extended to compare Presto with the browser.

## Architecture & Implementation

### Shape

- **`apps/showcase/src/presto/`** (new; real-proof builds only, since `PROVES` is a build-time constant and fake-proof bundles drop every import of it):
  - `prover.ts`: one `PrestoProver` per page, built with the page's shared `WASMSimulator`, its config from the build (`__SHOWCASE_PRESTO__`: the default ports in production, claimed ports in local test builds), and `setForceLocal(true)` before any `await`. Its `onPhase` drives **per-proof attribution**: each proof starts unattributed (reset when the wallet's `proveTx` begins); `transmit` marks it *on its way to Presto*; `fallback` marks it *browser*; `proved` after `transmit` with no `fallback` commits it as *Presto*, and any other completion commits *browser*. The UI reads two values: the in-flight attempt (for the working copy) and the last committed result (for the chip).
  - `consent.ts`: an adapted copy of the SDK's documented `askBeforeConnecting` (MIT; the package does not export it). It sets force-local first, reads `loopbackPermission()` on start (`granted` connects without a click), connects only from a click otherwise, follows `watchLoopbackPermission()`, and keeps the example's **epoch**: a revocation (`denied`, or `prompt` after a grant) bumps it and forces local, so a status check that started earlier can never turn native proving back on. Before each proof, `beforeProving()` re-reads the permission and, if it is no longer granted, forces local before the proof starts. It reports a view: `"ask" | "blocked" | PrestoStatus`, and `stop()` unsubscribes and forces local.
  - `PrestoRibbon.tsx`: a React wrapper around `<presto-banner variant="ribbon" theme="light" fonts="none">`, with Presto's own faces (Bricolage Grotesque, Figtree) self-hosted from `@fontsource-variable` packages and loaded with the component; the element's font custom properties name them if its default stacks use other family names. It maps the view: `ask` → `state="connect"`, `blocked` → `state="permission-blocked"`, a status → `banner.status`. `presto-banner:connect` and `presto-banner:retry` call `connect()`. `@alejoamiras/presto-banners/register` loads lazily with the component.
- **Lifecycle.** `demo/start.ts` creates the simulator and the prover (forced local) before opening the wallet, for every route, because the wallet is opened once per page. The consent controller belongs to `live/LiveRoot.tsx`: created when "Try it yourself" mounts and stopped on unmount, which forces local again. The tour and the `#proving` harness never start it, so they always prove in the browser, even for a visitor whose browser already granted the permission.
- **`demo/wallet.ts`**: `DemoWalletOptions` gains optional `prover` (passed to the PXE as `proverOrOptions`), `simulator`, and `beforeProving`. The `proveTx` interception resets the proof's attribution and awaits `beforeProving()` before emitting `"prove"` and proving.
- **`ui/Layout.tsx`**: an optional `notice` slot above `composer`; `live/LiveMode.tsx` passes the ribbon there.
- **Copy and chip**: `LiveMode.tsx:95` ("proven in this browser") says Presto while connected; `useLive.ts:17` and `Verdict.tsx:20` ("Proving in this browser") follow the in-flight attempt; the Prove chip reads "Prove · Presto" only from a committed native result.
- **`build/target.ts`**: `BuildTarget` gains `presto: { port, httpsPort }`. Local builds read `PRESTO_PORT` / `PRESTO_HTTPS_PORT` (integers 1–65535, distinct; default 59833 / 59834); a testnet build refuses either variable, like every other override. `cspFor` adds `https://127.0.0.1:<httpsPort>` and `http://127.0.0.1:<port>` to `connect-src` only when `proofs === "real"`. `vite.config.ts` defines `__SHOWCASE_PRESTO__`.
- **Dependencies** (`apps/showcase/package.json`, exact pins): `@alejoamiras/presto@6.0.0-rc.1`, `@alejoamiras/presto-banners@1.2.0`, `@aztec-labs/simulator@6.0.0-rc.1` (already in the lockfile through the PXE), `@fontsource-variable/bricolage-grotesque` and `@fontsource-variable/figtree` (5.3.0, past the 7-day gate). The three `@alejoamiras` packages were resolved once under a temporary `minimumReleaseAgeExcludes` and the entry removed: the gate applies only when a version is resolved, so the frozen lockfile installs them from an empty cache without it, and `bunfig.toml` keeps no standing exemption (its own rule).

### Key interfaces

```ts
// presto/prover.ts
export type ProofSource = "browser" | "presto"
export interface PageProver {
	prover: PrestoProver
	/** The proof in flight: undefined until the SDK says where it goes. */
	attempt: Observable<ProofSource | undefined>
	/** The last proof that finished, attributed only on completion. */
	last: Observable<ProofSource | undefined>
	startProof(): void
}
// presto/consent.ts
export type PrestoView = "ask" | "blocked" | PrestoStatus
export interface PrestoConsent { connect(): Promise<void>; beforeProving(): Promise<void>; view: Observable<PrestoView | undefined>; stop(): void }
// demo/wallet.ts
export interface DemoWalletOptions { usersTag: string; proves: boolean; payments: PaymentStore; prover?: PrivateKernelProver; simulator?: CircuitSimulator; beforeProving?: () => Promise<void> }
// build/target.ts
export interface BuildTarget { /* … */ presto: { port: number; httpsPort: number } }
```

`Observable<T>` is the `{ get(); listen(fn): () => void }` shape `StageFeed` already uses.

### Critical flow

1. Page load (real-proof build): simulator, then `new PrestoProver({ simulator, presto: { port, httpsPort }, onPhase })`, then `setForceLocal(true)`, then the wallet opens with that prover. No request has reached 127.0.0.1.
2. "Try it yourself" mounts: the consent reads `loopbackPermission()`. `granted` checks status without a click; otherwise the ribbon shows `connect` (or `permission-blocked` for `denied`).
3. Connect: `checkPrestoStatus({ forceRefresh: true })`; the browser may prompt now. If the epoch is unchanged and the permission now reads granted, `available` turns force-local off; the ribbon plays "Presto connected ✦" and hides.
4. A send: `proveTx` → `startProof()` → `beforeProving()` → `createChonkProof` → `transmit` or `fallback` → `proved` → attribution committed → the chip and copy follow.

### Alternatives not taken

- **Custom banner (option C as drawn)**: rejected by the owner for the official Ribbon, which already covers every state and dismissals.
- **Billboard**: it paints only `connect` and `offline`, and one status-driven surface is allowed per page.
- **Probing on load**: Presto's own docs forbid it (it triggers the browser's permission prompt unasked).
- **HTTP opt-in for the e2e build**: it would test a transport production never uses; the HTTPS proxy tests the real path.
- **Recreating the wallet when Presto connects**: unnecessary, since `setForceLocal` toggles the same injected prover.
- **A page-global "prover mode"** (the first draft): a stale value could label a later browser proof as Presto; per-proof attribution replaces it.

## Security & Adversarial Considerations

- **Threat model.**
  - A local process squatting Presto's ports answers the `/health` shape and receives a witness: mitigated by the SDK's browser default (HTTPS only, against Presto's name-constrained local CA), which the plan keeps; the page never offers HTTP proving.
  - **CSP is not consent.** The two new `connect-src` origins are reachable by any script running in the page, at any path; the CSP only bounds where the page may connect, while consent is enforced by our controller and, independently, by the browser's own Local Network Access permission, which blocks every request after a denial. Compromised same-origin code is outside what either can stop; script, style, frame and form policies are unchanged.
  - Consent: nothing contacts the device before Connect or an existing grant. After the browser reports a revocation, no new request starts: the epoch drops checks already in flight, and `beforeProving()` forces local before the next proof. A witness already sent cannot be recalled.
  - The HTTP origin exists for the SDK's witness-free `GET /health` diagnostic only. The Presto e2e asserts that no HTTP request other than `GET /health` leaves the page.
- **Least privilege.** The CSP widens only in real-proof builds and only `connect-src`. presto-server in tests runs with its own `PRESTO_HOME`, a claimed port, bound to `127.0.0.1` (its only bind), in its own process group. Its origin gating is not an exclusive boundary (it auto-approves localhost origins, and `ALLOWED_ORIGINS` only adds pre-approvals), so the test's HTTPS proxy enforces the exact run origin, rejecting any other `Origin`. The CI job keeps `contents: read`, and no `GITHUB_TOKEN` reaches presto-server.
- **Cryptography.** None of our own. The e2e proxy's certificate is a throwaway self-signed P-256 certificate made with `openssl` per run, valid for one day, written outside the state dir that CI uploads on failure, and deleted at teardown. The Presto test browser trusts that one certificate by its SPKI hash (`--ignore-certificate-errors-spki-list`), not every certificate: `ignoreHTTPSErrors` would also disable checks on the external CRS requests. If headless Chromium ignores the SPKI flag, Phase 2 records it, and the fallback is `ignoreHTTPSErrors` scoped to the Presto project.
- **Input validation.** The SDK validates its own config at runtime (host must be loopback, ports integers); the ports come from the build, validated in `resolveTarget`, never from the URL or storage. The banner receives only enumerated states and a `PrestoStatus` object.
- **Supply chain.** `@alejoamiras/presto@6.0.0-rc.1`, `@alejoamiras/presto-core@1.2.1` and `@alejoamiras/presto-banners@1.2.0` carry SLSA v1 provenance (origin, not safety). They were resolved once under a temporary exclusion from the 7-day gate (owner decision) that is not committed: the lockfile pins these exact versions, and any later bump goes through the gate again. presto-server is a pinned release checked against a committed sha256. The `bb` that presto-server downloads at test time is not pinned by us: presto-server checks it against GitHub's release digests for `AztecProtocol/barretenberg` (see Asks). The ranged dependencies (`@logtape/logtape`, `ms`) still pass the 7-day gate.
- **Frontend.** The banner renders its own template in Shadow DOM; we set attributes and properties only, never markup. `X-Frame-Options: DENY` and `frame-ancestors 'none'` stay.

## Assumptions

**Facts (verified).**
1. The one browser wallet is created at `apps/showcase/src/demo/wallet.ts:135` with `pxe: { proverEnabled: opts.proves, store }`; `EmbeddedWalletPXEOptions` includes `simulator` and `proverOrOptions` (`@aztec-labs/wallets/dest/embedded/embedded_wallet.d.ts:19,36`).
2. The PXE uses an injected prover as-is and otherwise builds `new BBLazyPrivateKernelProver(simulator)` with `simulator = new WASMSimulator()` (`@aztec-labs/pxe/dest/entrypoints/client/lazy/utils.js:40-52`).
3. `PrestoProver` extends `BBLazyPrivateKernelProver` from `@aztec-labs/bb-prover/client/lazy` and dynamic-imports `@aztec-labs/simulator/client` when given no simulator (`@alejoamiras/presto@6.0.0-rc.1` `dist/lib/presto-prover.js:2,19,90`).
4. The CSP allows `style-src 'self' 'unsafe-inline'` and `font-src 'self'`; `connect-src` is built in `cspFor` (`apps/showcase/build/target.ts:94-112`); local builds fake proofs unless `SHOWCASE_PROOFS=real` (`target.ts:46-49`).
5. presto-banners styles its Shadow DOM with a `<style>` element and `fonts="google"` injects a Google Fonts stylesheet; the Ribbon covers every state; one status-driven surface per page (banners README; `packages/banners/src/{element,fonts,styles}.ts`).
6. presto-server 1.1.3's linux-x86_64 release is one binary with sha256 `90b76733…7c41` (verified here); it serves HTTP only, accepts `PRESTO_PORT` only with `PRESTO_HOME`, auto-approves localhost origins and pre-approves `ALLOWED_ORIGINS`, and started serving on the default port when run with an unknown flag (`--help`, observed here).
7. Playwright is pinned at 1.63.0 (`apps/showcase/package.json:39`); Presto's own suite grants `local-network-access` with Playwright ≥ 1.58.
8. `minimumReleaseAgeExcludes` matches exact names only (`implementations-plan/lessons.md`).
9. Three copy sites claim proving "in this browser": `live/LiveMode.tsx:95`, `live/useLive.ts:17`, `ui/Verdict.tsx:20`.
10. The e2e egress fixture records only blocked requests (`e2e/fixtures/egress.ts:19-23`), and the Playwright config chooses projects and the preview's proof mode from `env.proving` alone (`e2e/playwright.config.ts:33-44`).
11. `startDemo()` opens the wallet for every route (`src/main.tsx:10`); only "Try it yourself" mounts `live/LiveRoot.tsx`.

**Inferences (to attack).**
- I1: Chromium honours `--ignore-certificate-errors-spki-list` for the page's `fetch()` to the HTTPS proxy in a Playwright-launched browser (moderate). Phase 2's infra spec measures it for page fetches; the Phase 4 spec covers the SDK's real path wherever it runs.
- I2: `--ip-address-space-overrides=127.0.0.1:<web port>=public` plus `grantPermissions` exercises the permission states (`prompt`, granted, revoked) in headless Chromium (moderate; Presto's own suite does it). It does not exercise the native prompt UI, or Firefox.
- I3: Sharing one `WASMSimulator` between the PXE and `PrestoProver` matches the default path, which shares it with the default prover (high).
- I4: `bb` 6.0.0-rc.1, downloaded by presto-server, produces proofs the testnet node accepts (high: same Aztec release). Local settlement does not prove it; the owner's preview run confirms it.
- I5: with `fonts="none"`, the ribbon picks up Presto's faces from the document's self-hosted `@font-face` rules, directly or through its font custom properties (moderate; Phase 3 checks it in the built page).

**Asks (resolved by the owner at approval, 2026-10-02).**
- A1, the `bb` presto-server downloads in tests, trusted through GitHub's release digests rather than a pin of ours: **accepted** (Aztec's own release channel, test-only).
- A2, the "Prove · Presto" chip and the copy changes: **kept**.
- A3, the ribbon's fonts: **Presto's own** (Bricolage Grotesque and Figtree), self-hosted from two `@fontsource-variable` packages.

## Plan audit

**Codex (GPT-6 Astra, high), 2026-10-02: `conditional approve (with conditions: close consent races, make proof attribution per-proof, and repair the e2e validation gates)`.** Every finding adopted:

- High, revocation underspecified → the epoch, `beforeProving()` forcing local, and tests for a check resolving after revocation and a revocation before a proof; the guarantee stated as "no new request after a reported revocation".
- High, `transmit` is an attempt → per-proof attribution committed on completion; tests for native then forced local, and transmit then fallback.
- High, egress evidence vacuous → the fixture records allowed requests too, before navigation; the spec asserts silence before Connect and after revocation, and only `GET /health` over HTTP.
- High, preview config → `e2e/env.ts` gains the Presto run; projects select and exclude explicitly; build and preview get the same proof mode and ports.
- Medium, CSP is not consent → stated as a trust boundary; asserted in the e2e.
- Medium, `ignoreHTTPSErrors` too broad → SPKI-specific trust; the key outside uploaded artifacts and deleted at teardown.
- Medium, `ALLOWED_ORIGINS` is not exclusive → corrected; the proxy enforces the exact origin.
- Medium, inferences overstated → I1, I2 and I4 narrowed; the owner's preview run is the testnet confirmation.
- Medium, unpinned `bb` and name-wide exclusions → Ask A1; no exclusion is committed (Phase 1 found the gate applies only at resolution).
- Medium, shared startup reaches `#proving` → the consent lives in `LiveRoot`; the tour and harness never start it.
- Medium, failure-path evidence → a locked, atomic binary install; teardown checks the owned process group (presto-server and its `bb` children); fake-proof bundles checked for no Presto module in any chunk; invalid port values tested.

## Phases

### Phase 1: build target, CSP and dependencies ✓

Add `presto` to `BuildTarget` (local env, validation, testnet refusal, defaults), the two origins in `cspFor` for real proofs, the `__SHOWCASE_PRESTO__` define, and the five dependencies (resolved once under a temporary age-gate exclusion, which is not committed). Extend `build/target.test.ts`: a real-proof CSP lists both origins at the given ports; a fake-proof CSP is unchanged; a testnet build refuses `PRESTO_PORT` and `PRESTO_HTTPS_PORT`; a non-integer, out-of-range or duplicate port is refused.

**Validation gate.** `bun install --frozen-lockfile` after committing the lockfile; `bun run lint && bun run typecheck && bun run --cwd apps/showcase test:components`. Pass: exit 0 each, the new target tests green. Layers: lint, typecheck, unit.

### Phase 2: e2e infrastructure for presto-server ✓

- `packages/local-network/scripts/install-presto.sh <dir>`: the version from `toolchain.json` (`prestoServer`), the release asset checked against the committed `presto-server-<version>.sha256` before extraction, installed under a lock (`flock`) into a temporary dir and renamed into `~/.cache/inference-money/presto-server/<version>/`, so concurrent runs never see a half-written binary.
- `e2e/env.ts`: a Presto run (`E2E_PRESTO_PORT`, `E2E_PRESTO_TLS_PORT`, `E2E_PRESTO_TLS_DIR`). `e2e/playwright.config.ts`: three explicit projects (showcase, proving, presto), each matching only its own specs; the preview server gets the run's proof mode and Presto ports, identical to the build's.
- `e2e/fixtures/egress.ts`: also records every allowed request (method and URL), so specs can assert what reached an origin.
- `apps/showcase/e2e/presto.sh` (sources `run/common.sh`): claims `web`, `presto` and `prestoTls`; boots the network, sets up the demo, builds real proofs with the claimed Presto ports; writes the throwaway certificate outside the state dir; starts presto-server in its own process group (`PRESTO_HOME` in the run's state dir, `PRESTO_PORT`, an `INFERENCE_MONEY_OWNER` marker) and reaps it by ownership proof like the sidecar; deletes the certificate's key at teardown; runs Playwright's `presto` project.
- The `presto` project: Chromium with `--ignore-certificate-errors-spki-list=<hash>` and `--ip-address-space-overrides=127.0.0.1:<web port>=public`; a fixture running the HTTPS proxy in the test process, which forwards to presto-server, rejects any `Origin` but the run's, records requests by method and path, and can be stopped by the test.
- An infra spec: with the permission at `prompt`, `loopbackPermission()` reads `prompt` and neither Presto origin has seen a request; after `grantPermissions`, a page `fetch()` to the proxy's `/health` returns presto-server's health shape under the served CSP; a request with another `Origin` is refused by the proxy.
- Scripts: `test:e2e:presto` (app and root).

**Validation gate.** `bun run lint` (shellcheck covers both scripts); `bun run test:e2e:presto -- presto-infra.spec.ts` exits 0; afterwards the run's process group is gone (`pgrep -g <pgid>` empty, which covers `bb` children), the run's ports are released, and the certificate's key is deleted. Then the same after an interrupted run (`kill -INT` the runner mid-spec). Layers: lint, e2e (local network).

**As built.** The installer is `apps/showcase/e2e/run/install-presto.sh`, its digest beside it (its only consumers are the showcase's browser runs). presto-server's `PRESTO_HOME` and the certificate live under `~/.cache/inference-money/presto-{home,tls}/<run>`, outside the state dir CI uploads. The browser marks the page, its node and anvil public (production's address spaces), so Presto is the only loopback target; Playwright's Chromium refuses an ungranted loopback request at once (the permission still reads `prompt`) rather than prompting. Details: `lessons/phase-2.md`.

### Phase 3: the product ✓

`presto/prover.ts`, `presto/consent.ts`, `presto/PrestoRibbon.tsx`; the `wallet.ts`, `start.ts`, `LiveRoot.tsx`, `Layout.tsx`, `LiveMode.tsx`, `useLive.ts` and `Verdict.tsx` changes; `testids` entries; the JSX type for `presto-banner`. Component tests (vitest, jsdom, a faked permission API and a fake prover):
- no status check before Connect while the permission reads `prompt`; `granted` connects without a click; `denied` shows `permission-blocked`;
- a status check that resolves after a revocation leaves proving forced local;
- a revocation reported before a proof forces local before that proof;
- attribution: a native proof commits "Presto"; transmit then fallback commits "browser"; after a native proof, a forced-local proof commits "browser" and the chip drops "Presto";
- unmounting "Try it yourself" stops the consent and forces local;
- the ribbon receives each view.

`bundle.test.ts`: on a fake-proof build, no chunk contains a Presto module; on a real-proof build, the Aztec SDK and Presto stay out of the eager chunk. The built ribbon renders in Presto's faces (checked once in the browser).

**Validation gate.** `bun run lint && bun run typecheck && bun run test` (every workspace, showcase components included); `bun run --cwd apps/showcase build:testnet` exits 0 (bundle and manifest-identity checks included). Layers: lint, typecheck, unit/component, build.

**As built.** Attribution lives in `presto/proofs.ts` (no SDK import, so its tests need none); the wallet runs each proof inside its `around`, which runs the consent's check first and credits the proof only when the call settles, because the SDK reports `proved` before it decodes Presto's answer and can still fall back after it. `presto/index.ts` (`pagePresto`) is the one module `start.ts` loads, and "Try it yourself" starts the consent through its `ask()` (`live/useLivePresto.ts`). The ribbon element is created outside React, attributes first: React 19 assigns a prop the element defines as a property, and `variant` is a getter. Presto's faces reach its shadow tree through `--pb-font-*` (`presto/ribbon.css`). No Vite dedupe for the simulator: the page passes its own, so the SDK's lazy import never runs, and the single copy resolves anyway. The browser font check (I5) runs in Phase 4's spec. Details: `lessons/phase-3.md`.

### Phase 4: the Presto spec, CI and docs

`apps/showcase/e2e/specs/presto.spec.ts`, with the egress record running before navigation:
1. The page loads; the ribbon shows Connect; neither Presto origin has seen any request.
2. Grant the permission and press Connect: the ribbon plays its connected morph and hides.
3. A private send settles; the proxy answered `POST /prove` with 200; the Prove chip reads "Prove · Presto".
4. Revoke the permission (`grantPermissions([])`): the next send settles through the browser, the chip reads "Prove", and neither origin saw a request after the revocation.
5. Grant again and reconnect, then stop the proxy (presto-server's HTTP port stays up): the next send settles through the browser; the only HTTP request was `GET /health`, never `/prove`.

CI: a `presto` job in `_e2e.yml` beside `e2e` (same toolchain setup, `bun run test:e2e:presto`, the same failure-artifact upload). Docs: the `AGENTS.md` command list (`test:e2e:presto` beside `test:e2e`), `docs/ci-pipeline.md`'s `showcase.yml → _e2e.yml` row (the `presto` job), and `docs/architecture.md` if it describes the showcase's prover.

**Validation gate.** `bun run test:e2e` (the main suite, unchanged CSP for fake proofs) and `bun run test:e2e:presto` both exit 0; `bun run lint:actions` exits 0. Layers: e2e (local network), workflow lint.

### Manual acceptance (owner, after the PR's preview deploys)

On the Workers preview, with the Presto desktop app running and normal certificate validation: press Connect, allow the browser prompt, run a send that settles on testnet, and see "Prove · Presto". This is the evidence for testnet compatibility (I4). Not a gate for the agent; recorded in the PR body.

## Post-implementation

Single arc. `code_review` is `off`, so no `/code-review` pass.

1. **Codex audit** (`/codex high`, GPT-6 Astra): the net diff from `2c52e23`, this plan, `recon.md`, and these asks: what could go wrong, what would an attacker target, what are we trusting that we shouldn't, where are the supply-chain, crypto and least-privilege weaknesses; does the consent flow ever reach 127.0.0.1 before Connect or after a revocation; can any copy or chip claim Presto for a browser proof. Include verbatim:
   > Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone.

   > Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact.
2. **Fix loop**: verify each finding against the code first; apply the accepted ones; commit; log the round (consult and verdict) in `lessons/phase-4.md`; resume the same Codex session with the fix diff and the same two rules. Repeat until a round brings no new material finding. Still material after 3 rounds: stop and surface it to the owner.
3. **Delivery**: only now, `gh pr create` (body ending with the Claude Code line, label `e2e`), then `gh pr checks --watch`.
4. **Close-out**, as the PR's final commits: write `## Outcome` right after this file's front matter (date, status, what shipped with the PR number, what was dropped and why, and a line retiring the seeds below); promote generalizable gotchas to `implementations-plan/lessons.md` within its budget (presto-server ignores unknown flags and serves; the 7-day gate applies only at resolution, so a young version needs a temporary exclude to lock, never a committed one); move open follow-ups to `implementations-plan/follow-ups.md`; `git mv implementations-plan/presto-showcase implementations-plan/archive/presto-showcase` in its own commit, repairing links; move the index line to `archive/index.md`. Then report and stop: merging is the owner's call.

## Delivery

| Arc | Phases | Stacks on | `/code-review` |
|---|---|---|---|
| presto-showcase (single PR) | 1–4, then the close-out commits | `main` | off |

One branch (`worktree-presto-showcase`), one PR via `gh pr create`; no stack.

## Seeds

ELI5: https://claude.ai/artifact/3hfNZtbR9zog97jFM5cbfm, published from `implementations-plan/presto-showcase/eli5.html` (local only; republish that file to update the same URL).

```
/goal All phases marked ✓ in implementations-plan/presto-showcase/plan.md, each ✓ backed by its phase's validation gate reported passing in the transcript; for each phase `LESSONS_FILE=implementations-plan/presto-showcase/lessons/phase-N.md` printed in the transcript; /code-review NOT run (code_review: off); the Codex fix loop converged on the net diff from 2c52e23, evidenced by a resumed Codex pass reporting no new material findings, quoted in the transcript; one PR exists, created only after that convergence (`gh pr view` output in the transcript), carrying the close-out that archived the plan (`git show --stat` of the archive-move commit in the transcript); `bun run test` and `bun run lint` both exit 0 in the transcript.
```

```
/loop 15m Drive implementations-plan/presto-showcase forward. Never idle waiting for my input. Each firing: 1. Reality check: read implementations-plan/presto-showcase/plan.md and lessons/ (authoritative; judge every step against its Outcome & Quality Bar). If that path is gone, the close-out ran: `git fetch -q origin && git cat-file -e origin/main:implementations-plan/archive/presto-showcase/plan.md` succeeds → merged, STOP; fails → babysit the PR's CI only, then STOP once green. A live plan.md with an `## Outcome` block means an interrupted close-out: finish it. Otherwise rebuild the task list from plan.md, `git status`, `git log --oneline -5`, and the PR's checks if a PR exists. 2. Waiting on CI is fine; confirm it progresses (`gh run watch` up to 10 min). 3. No task in hand? Take the next pending step; after each meaningful edit run `bun run lint` and the touched workspace's tests; commit, push the branch. 4. Stuck or facing a decision? Consult `/codex high`, decide, log it in lessons/phase-N.md. Hard limits stay: never merge, publish or deploy, never widen scope beyond plan.md. 5. Same step failed 5 times? Reassess with Codex. 6. Phase green means its validation gate as written passes: paste it, mark ✓, write the lessons entry, print `LESSONS_FILE=implementations-plan/presto-showcase/lessons/phase-N.md`. 7. All phases ✓? Run the Post-implementation section exactly (Codex audit and fix loop, then `gh pr create`, then the close-out commits, then `gh pr checks --watch`), write the wrap-up, and stop: merging is mine.
```
