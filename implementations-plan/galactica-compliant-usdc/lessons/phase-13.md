# Phase 13 — Testnet live check

Status: **prepared, gate pending**: `test:testnet` and the docs are committed; the gate needs P9's deployment (the manifest, the demo tag, the tour) and Ask 8's preview URL.

## Decisions

1. **The served CSP is the only fence.** The local suite confines each context to the run's origins; against a hosted page that would test the fence, not the page, so the testnet check records every JSON-RPC method instead and fails on any CSP violation the page reports.
2. **Tx links are checked on the chains, not the explorers.** Each recorded row must link its own hash in the pinned explorer route, and each hash is read back as executed from Sepolia and the Aztec node. Both explorers answer 200 for a hash that does not exist (checked 2026-10-01), so fetching their pages proves nothing.
3. **The deposit is left unclaimed.** P13 checks the Ethereum lane only; the deposit's claim ticket lives in the test's browser, so each run leaves 0.01 USDC escrowed (`docs/operations.md` says so).
