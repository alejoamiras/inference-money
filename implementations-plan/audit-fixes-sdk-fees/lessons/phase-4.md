# Phase 4: integration and the Codex fix loop

## Codex fix loop (gpt-6.1-sol, high)

**Round 1: fix needed, two findings, both adopted.**
1. Medium, fee choice fails open for untyped callers: an omitted `ListOptions.fee` reached the wallet as `undefined`, which makes the account pay, and an unknown `FeeChoice` did the same. Fixed: `sendFee` throws unless the fee is a payment method or `"account-public"`, evaluated before anything else in each payment call (before `payRequest`'s reservation); `feeFor` throws on an unknown choice and keeps the defaults for an omitted one. Tests: the legacy-name assertion now expects the throw; an untyped `ListOptions` without `fee` is refused with nothing sent.
2. Low, the unconfirmed-exit message overstated delivery and timing. The journal notes a tx when it is handed to the inner node, before the network call (or a recorder hook) can fail, so "reached the node" was not proven; and after the expiry a tx included earlier can still be short of finalized, so "settles it by then" was false. Fixed: the message says the tx "was handed to the node" and to resume "until it lands or a finalized block passes that time"; docs, test titles and the assurance map say "handed to the node".
