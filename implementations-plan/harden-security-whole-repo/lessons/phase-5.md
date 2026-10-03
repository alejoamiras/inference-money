# Phase 5: clients, a real network, docs

Gate (2026-10-02), the arc's last: at `10f2714`, after both review loops: `compile.sh --check`, `bun run test:noir`, `check-sole-consumer.sh`, `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:integration` (44 specs, then 4 clock specs on a network of their own), `bun run --cwd apps/showcase test:components` (91 pass, 5 skipped), `bun run test:e2e` (7 passed): all exit 0. The first full run of `test:integration` failed one spec on a flake (below); the tail from `test:integration` on was rerun at the same commit.

## Measured

- **The public search's cost:** a user's public payment whose stamp sits 2 hours back simulated at 723 164 L2 gas; one in a stamp's last hour (24 back, the full search) at 784 214. The 22 extra nullifier reads cost about 61 000 L2 gas, 8 %.
- **The standard expiry is 82 800 s on a real network**, asserted as a number for a tx that reads nothing and for a private payment through a stamp opened in the previous hour.
- **The cap by value:** a private payment through a stamp no longer fresh committed exactly `committedExpiry(tx, stampDeadline(b))`, under the standard lifetime.
- **A held proof past the deadline:** the node refused it outright ("Invalid tx"), and nothing completed the request.

## What bit

- **A warp's own block can sit short of the time asked for.** `aztecDebug_warpL2TimeAtLeastTo(boundary)` returned with a latest block still in the previous hour, and a payment sent at once anchored there. `warpTo` now waits for a block at or past the target; the heartbeat supplies one within seconds.
- **A flake in the acceptance run's L1 withdraw.** One full `test:integration` failed [A28]: `simulateContract` of `TokenPortal.withdraw` passed and the gas estimate right after reverted with no reason, in a smoke run whose request and payment had settled. The spec passed alone (11 of 11) and in the next full run; the withdraw path is untouched by this arc. If it recurs, suspect the estimate's pending block (local L2 blocks push L1 ahead) before the code.
- **The embedded wallet simulates before it sends**, so a public payment refused for `already paid` throws before anything reaches the node: the [A22] spec asserts "nothing sent" for both paths.
- **`stale` must be read as a type, not a message.** The showcase and the smoke replace a request only on `PaymentRefusedError` with reason `stale`; anything else (a wrapped error included) is thrown, which is the safe direction.

## Arc 2 Codex fix loop (default model, `medium`, read-only; one session, resumed)

| Round | Verdict | Findings and what became of them |
|---|---|---|
| 1 | 1 material | Two attempts refused as `stale` on one stored request could each open and pay a replacement: adopted, the gate opens the replacement under the stale request's lock and records it (`replaced`), so every attempt shares it (`db59fe8`). Two comment findings in the token: the stamp's `@dev` adopted; `_push_paid`'s duplicated `@dev` removed, its `@param` kept as the file's convention |
| 2 | 1 material | A replacement that went stale unpaid stranded callers still holding the original: adopted, `payReplacingStale` follows recorded replacements and opens at most one new request per call (`51ee76d`) |
| 3 | no new material findings | Converged |

## Cross-arc Codex pass (fresh session over `9f84cdb..HEAD`, `medium`, read-only; resumed)

| Round | Verdict | Findings and what became of them |
|---|---|---|
| 1 | 1 material | A `replaced` request answered `stale`, so a caller following the docs could open and pay a third request after the replacement was paid; the `in-flight` text also advised opening a new request. Adopted: a distinct `replaced` refusal that only `payReplacingStale` follows, the docs say to replace only through it, and `in-flight` says to wait (`10f2714`). Two minor: "a merchant payer never relies on a stamp" was wrong under the fresh-stamp-first order (reworded), and two `@param` lines removed |
| 2 | no new material findings | Converged |

## Decisions

- `payReplacingStale` lives in bridge-core, tested once against the real gate (a stale request is replaced and paid; one whose first payment is still recorded as sent opens nothing), and the showcase and the smoke call it. The smoke re-runs its request step as itself, so the recorded tour shows the request the payment completes.
- `test:integration` is `test:specs` then `test:clock`; attaching to a running network goes through `test:specs`, since the clock run refuses `NET_L1_RPC`/`NET_NODE_URL`.
