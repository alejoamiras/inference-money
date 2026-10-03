# Cross-arc review: Codex fix loop

A fresh Codex GPT-6 Astra session (high, read-only) over `git diff be70fec..HEAD`. The prompt asked for seams between the arcs, duplication across them, drift from the plan, the full adversarial ask, and both rules verbatim.

## Round 1 (session `01a10397`)

"No merge-blocking cross-arc findings. Confidence: high within this read-only review." Codex also replayed the static guard's 48 mutants in memory, and each failed for its expected reason. `MATERIAL FINDINGS: 0`

| Severity | Finding | Verdict |
|---|---|---|
| Nit | `ResidualBalance`'s doc names only a deposit left behind, but arc 1's surcharge test also reaches it when a fee spends donations | adopted: the doc names both. `test:evm` (81), `test:evm:gas` and `test:evm:slither` (0 results) all exit 0 |
