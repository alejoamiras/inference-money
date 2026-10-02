# Phase 2: e2e infrastructure for presto-server

## Built

- `apps/showcase/e2e/run/install-presto.sh` + `presto-server-1.1.3.sha256`: version from `toolchain.json` (`prestoServer`), digest checked before extraction, `flock` on the cache root, installed into a temp dir and renamed into `~/.cache/inference-money/presto-server/<version>/`.
- `e2e/run/common.sh`: `owns_group` / `stop_group` lifted out of `agent.sh` (the sidecar now uses them too), so presto-server is reaped by the same ownership proof.
- `e2e/presto.sh`: claims `web`, `presto`, `prestoTls`; builds real proofs with the claimed Presto ports; throwaway P-256 certificate and `PRESTO_HOME` under `~/.cache/inference-money/presto-{tls,home}/<run>` (outside the uploaded state dir), removed at teardown; presto-server in its own group with an `INFERENCE_MONEY_OWNER` marker, no flags.
- `e2e/fixtures/presto.ts`: the HTTPS proxy (run certificate, exact-`Origin` check, request log, stoppable) and the SPKI pin.
- `e2e/playwright.config.ts`: one project per run kind (showcase, proving, presto); the preview gets the build's proof mode and Presto ports.
- `e2e/fixtures/egress.ts`: records allowed requests too.
- `e2e/specs/presto-infra.spec.ts`; `test:e2e:presto` scripts.

## Attempts

1. First gate run: `net:up` refused `AZTEC_NODE_HOME=~/.cache/inference-money/aztec-node-6.0.0-rc.1` (no `node_modules/.bin/aztec`, an incomplete install). Reran with a complete one. Not a code issue.
2. Second run: 3/3 passed, but the page's console showed `Permission was denied for this request to access the loopback address space` for the run's own Aztec node and anvil. Marking only the web port public made the page public while its node stayed loopback, which production never is (testnet node and Sepolia RPC are public). Fix: the override marks the web origin, the node and anvil public, so Presto is the only loopback target. The infra spec now proves the contrast: the page reaches its node without the permission, and not Presto.
3. Gate (`scratchpad/gate2.sh`, not committed): full run 3/3 passed; then a run interrupted with SIGINT to the runner's process group during the first spec (presto-server alive at that moment), exit 130. After each: presto-server's group gone (`pgrep -g` empty), no `~/.agents/ports.md` row for the run, TLS dir and Presto home gone, network down.

## Findings

- I1 holds: headless Chromium 153 (Playwright 1.63's headless shell) honours `--ignore-certificate-errors-spki-list` for the page's `fetch()` to the proxy. No `ignoreHTTPSErrors` needed.
- I2, sharper than assumed: with the permission unset, Playwright's Chromium refuses a loopback request at once (`TypeError: Failed to fetch`, console: permission denied for the `loopback` address space) while `navigator.permissions` still reads `prompt`. There is no prompt to wait on, so a Connect without `grantPermissions` fails like a dismissed prompt.
- Playwright 1.63 maps `local-network-access` to CDP `localNetworkAccess`, `localNetwork` and `loopbackNetwork`, so one grant covers both of Chrome's split permissions.
- presto-server answers `/health` with `{status: "ok", api_version: 1, …}` to the pre-approved run origin through the proxy.

LESSONS_FILE=implementations-plan/presto-showcase/lessons/phase-2.md
