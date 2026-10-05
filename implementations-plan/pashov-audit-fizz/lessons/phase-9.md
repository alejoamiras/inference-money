# Phase 9: the bridge-core horizon mirror (2026-10-05)

| Attempt | Result | Consequence |
|---|---|---|
| `MerchantEntry` gains `delay`, `scheduledDelay`, `delayChangeAt` from the `sdc` `syncMerchantList` already read and dropped | `effectiveMinimumDelayAt`, `timeHorizon` and `merchantHorizon` transcribe aztec's `get_effective_minimum_delay_at` and `get_time_horizon`; `merchantSide` compares horizons, the first side winning a tie. | The mirror does not copy the Noir hint's early return when the first side already has the longest horizon: it only saves a node query, and the side is the same. |
| Literal cases | `merchants.test.ts` pins the TXE suite's offsets (settled 24 h, the hour, unset, a pending switch-off, a decrease two hours in, around its landing, unlisted 0) and the side picks for a 1 h entry and a pending decrease. | The unset-delay case exists only here: the token always schedules a delay when listing. |
| Callers | `payments.ts` builds capsules only for private-to-private transfers and request openings, whose side order the token kept, so no capsule changed. `merchantStatus` keeps `{ merchant, pending }` for the deployer. | The integration spec `[A20]` now checks the synced entry's delay and that its horizon is the switch-off − 1 on a real chain (run in P11's gate). |
| `bun run lint` | Biome reflowed two long object literals. | `biome format --write`. |

Gate: `bun run lint` exit 0, `bun run typecheck` exit 0, `bun run test` exit 0 (run over P8 and P9 together).
