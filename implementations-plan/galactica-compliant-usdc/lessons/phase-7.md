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

## Codex, arc 3 (GPT-6 Astra, high; session `01a0f55a…4a0a`)

**Round 1** (review of `galactica-compliant-usdc-messages..HEAD`): no theft, redirection, unbacked mint or binding bypass found; three findings, all verified against the code and fixed in `8867f55`.
1. *Medium, accepted.* A deposit returned by someone else (say the recipient of a refused gift) left its depositor without the return's tx hash, which `exitTicketFromTx` needs. `depositFate(ticket, node, manifest)` now finds the tx that consumed the message by its nullifier and reads whether it paid the depositor; the binding spec recovers the stranger's payout from its deposit ticket alone.
2. *Medium, accepted.* The first-claim race ran both claims through `Promise.allSettled`, so the loser could fail in the binding preflight once the winner landed, which proves nothing about the sequencer. The harness's `sendTogether` now holds every submission until both claims are proven against the unbound account; the spec asserts two submissions, one landing, and a nullifier rejection for the other.
3. *Low, accepted.* The guard matched rule text, so `if false { assert(…) }` passed it. `flow_is` pins each guarded body's branches to its rule conditions and refuses loops, matches and closures; two mutants cover it (34 in all). The header now says the guard pins text and shape and the TXE suites prove enforcement.

The round-1 prompt omitted the plan's two verbatim review rules (no over-engineering, comment quality); round 2 carries them, as every later arc prompt must.

**Round 2** (same session, with the verbatim rules): not converged; three findings, all accepted and fixed in `d8f56a5`.
1. *Medium.* One tx can batch a claim of deposit A with a return of deposit B for the same depositor and amount, so "the consuming tx emitted the depositor's withdrawal" does not prove A was returned. `depositFate` now reports `{ consumed, l2TxHash, withdrawal }`, with `withdrawal` documented as a candidate; finishing it pays the depositor either way.
2. *Low.* `flow_is` required whitespace after `if`, so `if(false) { … }` passed; it now takes `if` followed by any non-identifier character (mutant `paren_branch`, 35 in all).
3. *Low.* The recovery spec recorded the recovered withdrawal on the books but never collected it; it now withdraws on L1 and asserts the stranger's USDC rises by the deposit.

**Round 3:** converged ("no material findings remain in arc 3 at `d8f56a5`").
