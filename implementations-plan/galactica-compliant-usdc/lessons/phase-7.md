# Phase 7 — TS flows, integration, docs

Status: **green 2026-10-01.**

## Gate evidence

- `bun run --cwd contracts/evm build`, `bun run lint`, `bun run typecheck`.
- `bun run test`: bridge-core 155, deployer 30, local-network 14, web 93 (+1 skipped), contracts 2 + 6.
- `bun run test:integration`: 32 of 32 in 895 s, the 8 new ones among them: binding `[A23]` (the binding and its refusals, a first-claim race leaving one binding and returning the loser), exit-rules `[A24]` (a user's exit only to its funding address and paid on L1, a merchant's anywhere, an exit paid on L1 while the bridge is paused), returns `[A25]` (an L1 payout to the depositor with supply unchanged, a user's public deposit returned and a merchant's only claimed, claim and return exclusive, the pause). The acceptance, returns and exit-rules specs end on the books. The run preceded two edits outside its code path: a doc-comment reflow and a unit test's pinned give-up text.
- `RUN_ID=p7`: `deploy:local` then `verify:local` exit 0.
- `bun run --cwd apps/web test:components`: 93 (+1 skipped).

## Findings

1. **A return consumes the claim's own nullifier**, so a consumed message no longer proves a mint. `ClaimResult` reports `consumed-unknown` instead of `already-consumed`, and the returns spec pins that a claim after a return reads it.
2. **The binding check runs inside the claim, before simulation.** `claimBinding` reads the recipient's own note and throws `NotFundingAddressError` for a deposit from another address, so `waitClaimable` rejects with it as soon as the message is included: the earliest point a client can offer the return. Such a deposit never passes the claim probe, so the return waits on its own simulation (`waitReturnable`); both share `waitConsumable`.
3. **The books equation is kept as deltas per spec.** Specs run one at a time, so the portal's USDC change must equal the supply change plus the spec's unconsumed deposits plus its unpaid withdrawals. The deposits and withdrawals are the spec's own tickets: a message's nullifier needs its secret, which only the depositor's records hold.
4. **The public-recipient preflight is a pure check on a list synced whole** (`assertPublicRecipient(syncMerchantList(...), recipient)`), so the node never learns which recipient a deposit is for. It is not wired into `submitDeposit`: that would widen its node type for every caller, and the bridge refuses the claim anyway, leaving the deposit returnable.
5. **The L2 does not assert a non-zero depositor**, though the plan's input-validation list names one. No message can name zero: a direct deposit names its caller and the bound router names the Permit2 signer it pulled from, so a zero depositor only fails to consume, like any other wrong one.
6. The old app's e2e still deposits publicly to, and exits publicly from, the connected user account, which the rules now refuse. Its typecheck and component tests stay green; the e2e moves to the showcase in P10, as planned.
