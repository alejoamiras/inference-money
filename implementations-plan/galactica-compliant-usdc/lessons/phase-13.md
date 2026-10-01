# Phase 13 — Testnet live check

Status: **done** 2026-10-01: the gate passed against the Workers preview of `1e4bb74` (version URL `efc5e736-inference-money.alejo-amiras.workers.dev`): both specs green in 2.7 min, no CSP violation.

## Decisions

1. **The served CSP is the only fence.** The local suite confines each context to the run's origins; against a hosted page that would test the fence, not the page, so the testnet check records every JSON-RPC method instead and fails on any CSP violation the page reports.
2. **Tx links are checked on the chains, not the explorers.** Each recorded row must link its own hash in the pinned explorer route, and each hash is read back as executed from Sepolia and the Aztec node. Both explorers answer 200 for a hash that does not exist (checked 2026-10-01), so fetching their pages proves nothing.
3. **The deposit is left unclaimed.** P13 checks the Ethereum lane only; the deposit's claim ticket lives in the test's browser, so each run leaves 0.01 USDC escrowed (`docs/operations.md` says so).

## Findings

1. **Workers Builds failed its deploy step on a Worker-name check, with the names equal.** The build passed; `wrangler versions upload` then stopped at "The name in your wrangler.jsonc file (inference-money) must match the name of your Worker". Wrangler raises that both when the API finds no Worker by the config's name and when the Worker it finds is not the one the build is attached to (`WRANGLER_CI_MATCH_TAG`, identical in 4.145 and 4.146). The repo connection in the dashboard was stale after the setup changes; disconnecting and connecting it again fixed it.
2. **`npx wrangler` ran a release published 22 minutes earlier.** The deploy command fetched the newest wrangler (4.146.0) at deploy time, outside the lockfile and the 7-day age gate, with the build's Cloudflare token in its environment. Both deploy commands now pin `wrangler@4.138.0`, the newest release older than 7 days on 2026-10-01; `docs/operations.md` names them.

## Codex, arc 5 boundary (GPT-6 Astra, high; session `01a0f87e…7e57`, account alejo-gmail)

Scope: the showcase arc's own commits (P10–P13 and the socket fix); P9's commits on the same branch were the arc-4 boundary's.

**Round 1:** not converged, nine findings, all verified against the code (and, for the privacy one, the testnet chain) and accepted:

1. **High: a claim's secret was forgotten at its checkpoint.** `claim` keeps "consumed" only at a checkpoint, and bridge-core's contract says to keep the secret until `waitClaimFinalized`; the page dropped the ticket at once, so a pruned epoch would strand the deposit. A claimed ticket is now kept, skipped while its claim is checkpointed, dropped once final, and claimable again once its nullifier is gone.
2. **High: a burn could vanish from recovery.** The exit was stored only after `exitToL1` located its message, so a reload during the checkpoint wait, or an `ExitUnconfirmedError`, lost a burn. `exitToL1` now hands the hash to `onSent` before the wait (a throwing `onSent` is still an `ExitUnconfirmedError`); the page stores it there, and the payout pass locates the withdrawal from it after a reload, dropping a burn that reverted or never mined (a dropped receipt counts only after 10 min, since a load-balanced node may not know a fresh tx).
3. **High: the conflict retry could settle the wrong step.** It took the attempt's last send as "its own": when a payment's simulation hit a duplicate nullifier after the request it had just opened landed, the request settled the payment. The recording node now marks a send the node refused, and only a refused send whose earlier copy lands (waited for while pending) settles; anything else retries once.
4. **Medium: payment amounts were labelled hidden.** `complete_from_private` emits the completed note's value unencrypted (`emit_private_log_unsafe`): the testnet pay tx's only private log is `[tag, 0x07, 0x989680]`, 10 USDC in the clear, which `docs/integration.md` already listed as visible. The decoder now reads it as a readable amount and counts it out of "encrypted logs"; the testnet tour was re-decoded from the chain (only `pay` changed), the fixture tour edited to match, and the pay row's public text says the amount is public.
5. **Medium: payout checks could overlap** (the 30 s poll and a run's refresh), each sending the same withdrawal. One check runs at a time.
6. **Medium: storage could block recovery.** A stored `null` crashed the sort, an unreadable ticket threw before the per-entry catch, and a blocked `localStorage` threw from the default parameter. Entries are shape-checked on read, each payout fails alone, and storage is read inside the catch.
7. **Medium: the e2e sidecar's teardown lost ownership with its leader.** It is now spawned with this run's marker, a marked member proves a leaderless group, and its wallet dir goes once no process holds its pid.
8. **Low: teardown recomputed the data dir**, stranding a run named before the digest change; it now removes the handle's own record when that is a child of the net root.
9. **Low: comments.** The socket bound claimed every number at its widest (it reserves widths); `classify`'s doc restated its signature.
