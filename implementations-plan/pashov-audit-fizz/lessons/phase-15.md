# Phase 15: bind before listing (2026-10-05)

| Attempt | Result | Consequence |
|---|---|---|
| Seed order in `runSetup` | `BIND_SEEDS` (galactica's and supplier's one-cent private deposits from their own treasuries) are deposited, claimed with consent and kept until final. Both bindings are then read back (`ops.bound`). Only after that does `ops.list` run, followed by `USER_SEEDS`. | Galactica's public float needs it listed, so listing must come before the user seeds. |
| Resuming and the testnet stop | A binding seed runs if its ticket or draft is stored, or if its merchant is unbound. On resume, a merchant already bound to its treasury therefore deposits nothing again, and a stored ticket is claimed again (`castClaim` answers "already"). A stop at the listing keeps the binding tickets in the plan. | Unit tests: the seed order and the "list now" stop with its resume, a poisoned binding refused before any deposit, and a crash mid-seed. |
| A poisoned merchant | `ops.bound` throws when the funding note names anything but the merchant's treasury. The message names the recovery: redeploy, or list another merchant account. | Accepted demo residual A2: the cast's keys are public. |
| Widening to every actor | `demoL1`, `DepositPlan.from` and `DEMO_L1_TARGET` cover the merchants. Each merchant is topped up to 0.01 ETH and one cent, so the cast's accounts together hold at most 0.04 ETH and 50.02 USDC. One base unit first: it left galactica's balance off whole cents, which the showcase shows to six decimals, and the e2e (P17) failed on it. | The testnet L1 key must hold that much before `demo fund` (runbook). |
| `merchants add` | It prints a one-line reminder: the binding is a private note the CLI cannot read. | — |

Gate: `RUN_ID=p15 bun run net:up && deploy:local && bridge demo setup local && bridge smoke local`, then `net:down`, exit 0. The merchants were funded, both binding claims landed, the merchants were listed, the user seeds were claimed, the tag was published, and the output ends "smoke passed". The network was stopped by its owned pgids.
