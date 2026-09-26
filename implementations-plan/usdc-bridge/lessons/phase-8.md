# Phase 8 — App scaffold, wallet layer, e2e harness (`apps/web`)

Status: **code complete; ✓ deferred.** Every gate command passes except the literal `bun run --cwd apps/web build`. It embeds `deployments/testnet.json`, which exists only after Phase 7, and Phase 7 is still blocked on testnet USDC. The ✓ lands when Phase 7 does and the literal gate re-runs.

## What was built

- **Scaffold.** Vite 8 + React 19.3 + TS strict + Tailwind 4.3 (`@tailwindcss/vite`, `@theme inline` over CSS variables) + radix-ui primitives styled shadcn-style with `tailwind-variants`. Neutral placeholder palette, light and dark.
- **One network per bundle** (`build/target.ts`).
  - `BRIDGE_MANIFEST` names the manifest to embed (default `deployments/testnet.json`); `build:testnet` (`BRIDGE_TARGET=testnet`) pins the committed file and refuses `BRIDGE_MANIFEST` and `WEB_WALLET_URLS`.
  - The manifest is `define`d into the bundle and re-parsed at startup; there is no runtime override.
  - `WEB_WALLET_URLS` (iframe test wallets) is accepted only for a `local` manifest.
  - The same target generates the CSP (`connect-src 'self' <node origin>`, `frame-src` = the test wallet origins or `'none'`, `frame-ancestors 'none'`), `dist/_headers` for Workers static assets, and the preview server's headers, so e2e runs under production headers. Dev gets COOP/COEP only (its inline HMR preamble would trip the CSP).
  - `wrangler.jsonc` is assets-only.
- **L1** (`src/wallet/l1.ts`): wagmi 3.7.7, one `injected()` connector, `unstable_connector(injected)` transport so every L1 read goes through the wallet (no page RPC, no CSP hole). The chain is defined from the manifest with no RPC URL. Chain guard: connected on another chain → `wrong-chain` + a switch button. `l1Context()` hands bridge-core its `L1Ctx` at action time.
- **Aztec session** (`src/wallet/aztec-session.ts`, delegated to a Fable subagent, reviewed): the frozen Vue composable ported near-verbatim onto a tiny `cell` store (`.value` access kept) with a frozen, identity-stable `getSnapshot()` for `useSyncExternalStore`. Dropped: nulo's schema patch, legacy app-id storage, the URL chain-id override. `chainInfo` and `webWalletUrls` are injected. 20 session tests + 5 error tests.
- **Grant** (`src/wallet/capabilities.ts`): exact contracts and functions, no wildcard. Sends: bridge `claim_*`/`exit_to_l1_*`, token `burn_*` (the exit authwit's target), `STANDARD_AUTH_REGISTRY_ADDRESS.set_authorized`, the sponsor's `sponsor_unconditionally`. Simulations: `balance_of_public`, the claim dry-runs, the sponsor call; utilities: `balance_of_private`. The sponsor drops out entirely on a network without one.
- **Connect UI**: picker (every announcement its own row; wallet icons only as `data:image/`), 3×3 emoji check, account chooser, account menu with switching, one-shot notices.

## E2E harness (`apps/web/e2e`)

- **Why a sidecar.** The deployer and local-network packages are Bun-only (`import.meta.dir`); the Playwright runner is Node. Rather than a Node JSON-import hook and a Node-compatible network layer, everything that needs the network's L2 runs in a Bun sidecar (`e2e/run/sidecar.ts`): sponsor-deployed actor accounts on request (`POST /actors`) and the block heartbeat. The Playwright process imports only viem and Playwright. The freeze's Node JSON-import hook is therefore unnecessary: nothing in that process loads `@aztec/*`.
- **Shared helpers.** `newSponsoredAccount` and `startBlockHeartbeat` moved from the integration harness into `deployer/src/local-actors.ts`; the harness and the sidecar both use them. `claimServicePorts` generalizes local-network's port claimer; `claimNetPorts` is now a call to it.
- **Runner** (`e2e/agent.sh` + `e2e/run/resolve-ports.ts`): ports (registry-claimed; `ports.json` records the checkout-namespaced run id) → `net:up` → `deploy:local` → app and test-wallet builds → bundle assertions (both name the node; the app lists each wallet URL) → sidecar (own process group; leader pid + start time recorded) → Playwright → reap (sidecar group by verified identity, `net:down`, run manifest and forge cache, registry rows).
- **Test wallet** (`e2e/test-wallet`): `@aztec/wallets` EmbeddedWallet behind `IframeConnectionHandler`, one origin per profile (`main` all actors, `solo` one, `late` answers discovery after 4 s). **Capability enforcement** (`guard.ts`): every gated call (`sendTx`, `simulateTx`, `executeUtility`, `registerContract`, `createAuthWit`, `getAccounts`, and each call inside `batch`) is checked against the recorded grant and refused outside it; refusals are logged and exposed as `denied()`. Fault injectors `failNext`/`holdNext`/`swallowNext` (matched by method + argument substring), `release`, `dropNextSubmission`, `declineNextGrant`. The detect-node alias and the sqlite-OPFS wasm emit are ported.
- **Fixtures**: the L1 shim (`window.ethereum` → Node viem over anvil: reject/hold/swallow, per-method counts, captured Permit2 permits, chain/account events), the egress fence (auto; asserts zero blocked requests after every test), the parked wallet panel, worker-scoped actor pools with a spare, a fresh funded L1 key per worker.

## Attempts

1. **`@types/node` 24 vs 26.** Pinning `@types/node@24.13.6` (the newest release older than 7 days by publish time) made it the isolated linker's hoisted fallback, and TypeScript loaded it beside bun-types' `@types/node@26.6.1`: local-network's typecheck failed (`Property 'once' does not exist on type 'Server'`). Fix: pin the repo's 26.6.1.
2. **Run id.** The first e2e run read `net/<RUN_ID>.json`; `runIdFor` namespaces the tag by checkout (`0beccc70-<tag>`). The port claimer now resolves and records the id; every path keys on it. Teardown on that failure was already clean (both groups stopped, rows released).
3. **The CSP blocked bb.js.** The app never rendered: bb.js fetches its own wasm from a `data:application/gzip` URL, and `connect-src` refused it ("Failed to fetch"). `connect-src` now carries `data: blob:`, and the target test pins it. The stuck run was interrupted with `SIGINT` to its Playwright pid; teardown was clean.
4. **Account order.** The wallet lists granted accounts in its own order, so the spec compares sorted arrays.

## Gate evidence

- `bun run lint`: exit 0. `bun run typecheck`: exit 0.
- `bun run --cwd apps/web test:components`: exit 0.
- The build with a fixture manifest: exit 0. `dist/_headers` is generated.
- `bun run test:e2e -- connect.spec.ts`: **5/5 passed** (57.4 s), run `0beccc70-web-e2e-686989-64769`. The egress fence was empty after every test. Teardown left no net handle, no run manifest, no registry rows and no sidecar.
- `bun run test:integration`, re-run after the shared-helper refactor: 16/16 passed, exit 0, teardown clean.
- Literal `bun run --cwd apps/web build`: blocked on the missing `deployments/testnet.json` (Phase 7).
