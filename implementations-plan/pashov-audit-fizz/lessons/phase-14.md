# Phase 14: `allowBind` (2026-10-05)

| Attempt | Result | Consequence |
|---|---|---|
| Where the consent check runs | `claimCall` (the backstop, re-run on every `waitClaimable` poll) checks consent through `consentedBind`. `waitClaimable` also checks it once before polling, since otherwise an uncommitted message would poll for ~10 min before the refusal. `claim` builds the call before its `try`, so the error never passes through the nullifier or sponsor handlers. | The fake wallet counts `executeUtility` (the binding read) apart from `simulateTx`, so "zero simulations, zero sends" is testable. |
| Consent's shape | `ClaimConsent { allowBind? }` rides on `claim`'s opts and on `waitClaimable`'s opts, not on `WaitClaimableOptions`, which returns share. `castClaim` forwards it as a fourth argument and never defaults it. | — |
| Callers | The integration funding fixtures (`claimable`, `claimFor`) and three direct claims that must reach the contract's own refusal consent explicitly. `binding.test.ts` checks the refusal with nothing sent. `demo setup` consents for its seeds and for its re-claims after a prune. `smoke` claims for a bound alice and needs no consent. | — |
| The showcase | Only users claim there, so only the user's wording ships. A decline returns "Nothing claimed: the binding was declined." and keeps the ticket. `LiveCtx.confirm` defaults to `window.confirm`; the demo users are bound by the setup, so the prompt is a backstop. | — |
| Running integration while editing | The integration harness imports `@inference-money/deployer`'s index, and the clock suite loads it in a second process ~25 min in. Edits to the deployer and demo were therefore held until the clock suite had started its deploy. | Never edit a package a running suite imports until its last process has loaded. |

Gate: `bun run lint`, `typecheck` and `test` exit 0; `bun run test:integration` 46/46 + 6/6, exit 0; `bun run --cwd apps/showcase test:components` 39 passed, 5 skipped.
