# Phase 13 — Testnet live check

Status: **done** 2026-10-01: the gate passed against the Workers preview of `1e4bb74` (version URL `efc5e736-inference-money.alejo-amiras.workers.dev`): both specs green in 2.7 min, no CSP violation.

## Decisions

1. **The served CSP is the only fence.** The local suite confines each context to the run's origins; against a hosted page that would test the fence, not the page, so the testnet check records every JSON-RPC method instead and fails on any CSP violation the page reports.
2. **Tx links are checked on the chains, not the explorers.** Each recorded row must link its own hash in the pinned explorer route, and each hash is read back as executed from Sepolia and the Aztec node. Both explorers answer 200 for a hash that does not exist (checked 2026-10-01), so fetching their pages proves nothing.
3. **The deposit is left unclaimed.** P13 checks the Ethereum lane only; the deposit's claim ticket lives in the test's browser, so each run leaves 0.01 USDC escrowed (`docs/operations.md` says so).

## Findings

1. **Workers Builds failed its deploy step on a Worker-name check, with the names equal.** The build passed; `wrangler versions upload` then stopped at "The name in your wrangler.jsonc file (inference-money) must match the name of your Worker". Wrangler raises that both when the API finds no Worker by the config's name and when the Worker it finds is not the one the build is attached to (`WRANGLER_CI_MATCH_TAG`, identical in 4.145 and 4.146). The repo connection in the dashboard was stale after the setup changes; disconnecting and connecting it again fixed it.
2. **`npx wrangler` ran a release published 22 minutes earlier.** The deploy command fetched the newest wrangler (4.146.0) at deploy time, outside the lockfile and the 7-day age gate, with the build's Cloudflare token in its environment. Both deploy commands now pin `wrangler@4.138.0`, the newest release older than 7 days on 2026-10-01; `docs/operations.md` names them.
