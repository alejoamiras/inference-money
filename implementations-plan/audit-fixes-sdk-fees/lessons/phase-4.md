# Phase 4: integration and the Codex fix loop

## Codex fix loop (gpt-6.1-sol, high)

**Round 1: fix needed, two findings, both adopted.**
1. Medium, fee choice fails open for untyped callers: an omitted `ListOptions.fee` reached the wallet as `undefined`, which makes the account pay, and an unknown `FeeChoice` did the same. Fixed: `sendFee` throws unless the fee is a payment method or `"account-public"`, evaluated before anything else in each payment call (before `payRequest`'s reservation); `feeFor` throws on an unknown choice and keeps the defaults for an omitted one. Tests: the legacy-name assertion now expects the throw; an untyped `ListOptions` without `fee` is refused with nothing sent.
2. Low, the unconfirmed-exit message overstated delivery and timing. The journal notes a tx when it is handed to the inner node, before the network call (or a recorder hook) can fail, so "reached the node" was not proven; and after the expiry a tx included earlier can still be short of finalized, so "settles it by then" was false. Fixed: the message says the tx "was handed to the node" and to resume "until it lands or a finalized block passes that time"; docs, test titles and the assurance map say "handed to the node".

**Round 2: fix needed, one doc finding, adopted.** `integration.md`'s fee bullet said every private flow throws `SponsorUnavailableError` while the sponsor cannot pay; payments propagate the wallet's fee error and an exit handed to the node is `ExitUnconfirmedError`. The bullet now names each case. Codex found no new code defect; both round-1 fixes hold.

**Round 3: clean.** Quoted: "The documentation fix matches the implemented error handling. No new material findings in the full net diff, within the plan's accepted limits." The loop converged.

## Integration (`RUN_ID=sdk-fees bun run test:integration`)

- Specs: 46 pass, 1 fail in 2238 s at load average ~290, on 7762f5d (the round-1 fixes landed mid-run; they only change a message and a pre-send check). The new `[A14]` spec passed: both matchers took the real private and public exit txs, and `locateWithdrawal` found each `sent` hash's withdrawal.
- The fail is operator `[A28]`: the acceptance run's exit settled through the journal, then its L1 withdraw failed in gas estimation, "gas required exceeds allowance: 86644" at 105 gwei, the known local smoke gas-cap failure. The `&&` in `test:integration` then skipped the clock specs; both run again separately after the rebase.
