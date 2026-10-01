# Phase 10 — Rename, strip, embedded wallet, proving harness

Status: **in progress**: every gate line but `build:testnet`, which needs P9's v2 manifest.

## The proving decision: live proving

`test:proving` on this host (12 cores, Chromium 153 in new headless mode, a local network, the proving check's warm-up transfer, then three transfers and three open-and-pays; `test-results/proving.json`):

| Run | transfer | open | pay | open + pay | warm-up | peak memory (renderer / browser's own) | quota |
|---|---|---|---|---|---|---|---|
| unconstrained | 7.6 s | 6.9 s | 7.0 s | 13.9 s | 13.6 s | 0.91 GB / 0.62 GB | none |
| 2 CPUs (`CPUQuota=200%`) | 21.4 s | 19.8 s | 20.6 s | 40.3 s | 34.2 s | 1.25 GB / 0.62 GB | bound: 1,303 s throttled |

A clean rerun on 7c42a8f, with nothing edited during it, agrees: unconstrained 7.5 / 6.6 / 6.9 / 13.5 s, on 2 CPUs 21.4 / 19.6 / 20.5 / 40.1 s, peak 1.17 GB.

Every median is far under the rule (90 s unconstrained, 240 s on 2 CPUs) and so is the peak (3 GB), on both readings of "the median": per step, which is what a visitor waits for on each click, and per open-and-pay pair. So the showcase proves live; it never falls back to a recorded proof for lack of speed.

What the numbers do and don't say:
- They time the page from the call to the node's receipt of the tx: PXE sync, simulation and proving. The wait for the checkpoint is a network property and is left out. On testnet the same work makes more node round trips over the internet; P13's live action measures that.
- bb.js sizes its thread pool by `navigator.hardwareConcurrency`, which is 12 under the quota too, so the 2-CPU run oversubscribes two cores with twelve threads. A real 2-core device runs fewer threads, so these numbers are pessimistic for it.
- The warm-up includes fetching the CRS from bb.js's hosts, once per page load.
- The browser's own measure (`performance.measureUserAgentSpecificMemory`) waits for a GC, so it sampled three and five times; the renderer's resident high-water mark is the reliable peak, and the decision takes the larger of the two. The scope's `memory.peak` (2.3 GB) also counts the runner, the preview server and the browser's other processes.

## Decisions

1. **The CSP adds bb.js's CRS hosts when the build proves.** The plan lists the CSP's `connect-src` as exactly self, `data:`, `blob:`, the node and the L1 RPC. Real proving in the browser fetches its proving key material (the CRS) from `https://crs.aztec-cdn.foundation`, falling back to `https://crs.aztec-labs.com`; bb.js hardcodes both. Without them a testnet build cannot prove at all. `cspFor` adds them only when `SHOWCASE_PROOFS` is `real` (always on testnet, never on a fake-proof local build), and `build/target.test.ts` pins both lists.
2. **"No wallet-sdk in the bundle" means none of its connect surface.** `@aztec-labs/wallets`' `EmbeddedWallet` extends wallet-sdk's `BaseWallet`, so `dest/base-wallet/` is bundled with it. The manager, the extension and iframe transports and the crypto/emoji modules are not. `build/bundle.test.ts` asserts exactly that, from the bundle's sourcemaps.
3. **`@aztec-labs/ethereum`'s config schemas stay in the bundle.** `@aztec-labs/stdlib`'s node types (`node-info`, the `AztecNode` interface, chain config) import four of its modules: `config`, `l1_contract_addresses`, `l1_tx_utils/config` and `contracts/committee_attestations`. They are zod schemas and address lists, not L1 clients, and no app code imports the package (biome's `noRestrictedImports` still bans it). The bundle assertion allowlists exactly these four modules, so its L1 clients cannot slip in, and an SDK bump that changes the list fails the check.
4. **One PXE store per deployment, the wallet DB at its default.** The PXE store is opened as `pxe_data_<bridge>` (sqlite-opfs, keyed again by the node's chain and rollup), so a redeploy on the same rollup starts from a clean store instead of one holding the old contracts and cast. The wallet DB stays `wallet_data`, since `WALLET_DATA_SCHEMA_VERSION` is not exported; stale accounts there are harmless (accounts are looked up by address). `createSchnorrAccount` is safe to repeat on reload: an instance the PXE holds is not registered again, and the wallet DB overwrites.
5. **A second tab cannot open the wallet.** The sqlite-opfs pool takes an exclusive Web Lock; a second tab's open fails with `SqlitePoolBusyError`, which the page turns into "The showcase is open in another tab: close that one, then reload." The page opens its wallet once, outside React, since StrictMode mounts twice.
6. **The old deposit and withdraw flows went with the connect surface.** They were driven by a user's wallets (prompts, chain switches, the fee fallback); the showcase signs for the demo cast itself, and P11 maps its steps to bridge-core directly. Their tests assured code nothing ships any more, so their assurance-map entries went too, and every e2e entry naming a deleted spec is blank until P12 refills it. `amount.ts` (exact USDC parsing) stays for the composer. bridge-core loses what only they used: A17's `retryOnUnregistered` with the wallet error-code decoder, the unused `humanizeWalletError`, and `predictedWorstMinFees` (every showcase fee is sponsored).
7. **The harness refuses to time a page that fakes its proofs**: the page reports its prover mode, and the spec fails unless it proves for real, so a misbuilt bundle cannot pass the rule on simulation times.

## Findings

1. **The build config runs under Node.** `vite build` executes its config with Node (the `vite` bin's shebang), which cannot resolve the workspace's extensionless relative imports and would load the Aztec SDK (and start bb) through any module that imports it. Everything `build/target.ts` imports is now a leaf: the demo file schema moved to `demo/files` (its one sibling import spelled `./users-tag.ts`), and local-network exports `./handle`, whose `import.meta.dir` became the portable `import.meta.dirname`.
2. **The wallet's SQLite-OPFS store needs `sqlite3.wasm` beside its worker chunk.** emscripten's `locateFile` fallback asks for a bare `assets/sqlite3.wasm`, which no bundler rewrites; the build emits unhashed copies (carried over from the test wallet's config, with its `detect-node` shim for pino).
3. **The headless shell has no `performance.measureUserAgentSpecificMemory`.** Chromium 153's headless shell throws "not available" on a cross-origin isolated page; the full Chromium in new headless mode answers. The proving project runs `channel: "chromium"`.
4. **This worktree's local network runs on its own node home** (`AZTEC_NODE_HOME=~/.cache/inference-money/aztec-node-galactica`, see phase 3); the default `~/.aztec/versions/6.0.0-rc.1` is incomplete on this host.
5. **The harness reads the working tree's build config at each preview start.** Each proving run (unconstrained, then 2 CPUs) starts its own `vite preview`, which loads `vite.config.ts` and `build/target.ts` from the checkout. Editing either mid-harness failed the second run's preview (a gate rerun on 5d054d2 did); never touch build config or e2e files while a harness runs.
6. **A long run id stalled the node at startup, silently.** The node binds Unix sockets in its TMPDIR (`<dataDir>/tmp`), the longest named `cdb-ts-<pid>-<thread>-<n>.sock` (`@aztec-labs/simulator`'s `cdb_ipc_server.ts`). The proving harness's run id (`<checkout>-showcase-proving-<pid>-<time>`) put that path at 108 bytes, past Linux's 107 usable in `sun_path`: the bind failed, nothing was logged, and `node_getNodeInfo` never answered within 300 s ("FATAL: net failed" on the P10 gate rerun). A run's data dir is now a fixed 16-hex digest of its run id, and `assertSocketRoom` refuses a TMPDIR without room before anything spawns.
