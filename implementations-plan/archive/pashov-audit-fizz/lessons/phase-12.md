# Phase 12: Aztec docs (2026-10-05)

| Attempt | Result | Consequence |
|---|---|---|
| The plan's line references (`integration.md:18,58,99`, `operations.md:72,75,79-87`) | They pointed at an older snapshot; the sections were found by content instead (linkability, "Your node", merchant exits; switch-off, delay, Emergency). | — |
| A pending delay decrease | Its read caps the tx at the old delay less the time since the decrease, so its txs keep the standard 23 h for about the first hour and lose whole hours after; architecture.md and operations.md say so. | — |
| The two Noir comments ("the address the funds came from") | Now "need not be the address that paid". `compile.sh` rewrote the bridge artifact's embedded source; it also renumbered the token's and proxy's debug file ids with nothing else changed, so those two were restored. `compile.sh --check` matches all three class ids. | Commit only the artifact whose embedded source changed. |

Gate: `bun run lint` exit 0; `compile.sh --check` exit 0; `check-sole-consumer.sh --self-test` and the check exit 0.
