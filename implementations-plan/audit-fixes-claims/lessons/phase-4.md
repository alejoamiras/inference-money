# Phase 4: docs, integration and e2e; the Codex fix loop

- The integration case waits for the real finalized block to reach the deposit, reads the nonce bit directly, and records the reader's own `readContract` result, so a failed read (which also answers `pending`) cannot pass it.
- The e2e reuses the A13 pattern: hold the deposit's `eth_sendRawTransaction`, reload under it, abort it. `holdNext`'s `held` now resolves with the held call's params, so the spec checks the held tx goes to the router. `recordRpc.rewrite` bends one method's real results until stopped; the spec moves only the finalized header's timestamp.
- Commitlint wants one type and a header of at most 100 characters (`test,docs:` failed).

## Codex fix loop (`gpt-6.1-sol`, high)

- **Round 1**: no runtime findings ("the nonce owner/word/bit/block selection is correct, the integration assertion prevents a failed read from passing vacuously, and the RPC rewrite is scoped to the test's browser context"). Three findings, all verified and adopted:
  1. [Low] `claim()`'s doc, `tickets.ts`'s `claimed` comment and assurance-map A19 still said the secret may go at finality. Reworded; the claim-finality test title that said "gives the secret up" now says what the code does.
  2. [Low] `architecture.md` and A11 promised more than the change: an undecodable record is still dropped, and the smoke still removes its finished journal (both outside this plan). Qualified to "no reader's verdict drops it".
  3. [Nit] `useChains`'s comment enumerated its state. Replaced with its refresh rule.
