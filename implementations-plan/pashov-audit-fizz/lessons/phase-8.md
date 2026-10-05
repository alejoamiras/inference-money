# Phase 8: hint horizons and call sites (2026-10-05)

| Attempt | Result | Consequence |
|---|---|---|
| Spikes S4 and S5, in a scratch copy while the Arc 2 campaign ran | Both yes (`lessons/phase-0.md`). | The globals moved to `hints.nr`; SP-34 is an entry-level TXE test. |
| aztec-nr's cap | `DelayedPublicMutable::get_current_value` sets `get_time_horizon(anchor, sdc.get_effective_minimum_delay_at(anchor))`, exactly the plan's formula. | `probe` computes the same two calls from the raw read it already made: no extra oracle call. |
| TXE timestamps | Public calls run at `last_block_timestamp()` and do not advance it; a settled 24 h entry caps at anchor + 86 399, a pending switch-off one second in at anchor + 86 398, a decrease to the hour two hours in at anchor + 79 199, around its landing + 3 600, + 3 599, + 3 599. | The literal offsets the TXE test and the bridge-core mirror both pin. |
| SP-33 as a real call | TXE runs a call in its own simulator, ignores the tx's expiry and exposes no effects, so no real call shows which entry it read; an `OracleMock` cannot reach the simulator either. | The tests check the hint in each call's argument order, then make the real call; P11's tripwire pins the two call sites' order (`(to, from, true)`, `(from, to, true)`). |
| Unset delay | The token always schedules a delay when it lists an account, so no TXE entry has an unset delay. | That case lives in the bridge-core mirror only (`MERCHANT_MIN_DELAY − 1`). |
| Rebuild | `compile.sh` changed only the token artifact (the proxy and bridge are byte-identical); token class id `0x2dfbbddf…d4c2`, pinned in `B/artifacts.test.ts`. | The testnet redeploy (Arc 5) publishes the new class. |

Gate: `bun run test:noir` exit 0 (token manifest 168 of 169 run, token_bridge 78, keystone 20); `check-sole-consumer.sh --self-test` and the check exit 0; `bun run --cwd contracts/aztec test` 6 pass; `compile.sh --check` exit 0 after the commit (token, proxy and bridge artifacts each match their source).
