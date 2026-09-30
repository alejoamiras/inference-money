# Phase 9 — Bridge UI (`apps/web`)

Status: **code complete; ✓ deferred.** Every gate command passes except the literal `bun run --cwd apps/web build`. That command embeds `deployments/testnet.json`, which exists only after Phase 7, and Phase 7 is still blocked on testnet USDC. The same build passes against the fixture manifest. Phase 8 is deferred for the same reason. Both phases get their ✓ once Phase 7 lands and the literal gate re-runs.

## What was built

The flows are plain TS controllers in `src/bridge/`, apart from React. Each keeps its state in a frozen-snapshot store (`flow-store.ts`, read through `useSyncExternalStore`). Everything a flow touches comes in through `BridgeEnv` (`env.ts`), read at action time:
- the manifest
- the node
- `l1()`, `l2()`
- the retry session
- tab locks
- the unload guard
- the account-switch gate
- `ops`: the bridge-core steps, which tests replace

`browser-env.ts` wires the real one: wagmi, the Aztec session, `navigator.locks` and `window`.

- **`DepositFlow`** (a class, so each step stays inside the function-size budget):
  1. **Confirm-time reads, fail-closed, in parallel:** USDC balance, Permit2 allowance, `predictedWorstMinFees`, `is_paused`, and the L1 head.
  2. **Approval:** `ensurePermit2Allowance` runs only if the allowance is short.
  3. **Draft:** `prepareDeposit`, then the draft is registered in the unload guard *before* `submitDeposit` signs. The core re-reads the pause after the signature.
  4. **Send failure without a recorded submission:** the draft is dropped and the form returns with a reason.
  5. **Send failure with a recorded submission:** the flow goes to `stuck`. From there it only ever re-checks (`confirmDeposit` again, or `reconcileDeposit`). It never re-sends. "Discard" appears only after `not-deposited`.
  6. **Claim:** pause check → `waitClaimable` → pause check → `claim`. The claim runs under the switch gate and `retryOnUnregistered`.
  7. **Sponsor unavailable:** `SponsorUnavailableError` → `fee-fallback`, which waits for an explicit accept before a `wallet-default` claim.
- **`WithdrawFlow`:**
  1. **Before any read:** `assertExitIntent` refuses zero, the portal and the router.
  2. **Reads and exit:** L2 balance and pause reads, then `exitToL1` under the gate + retry. The same fee fallback applies.
  3. **Burn landed but not located:** `ExitUnconfirmedError` → `unconfirmed`, with the finish form prefilled.
  4. **Proof:** `waitWithdrawable` runs outside the lock.
  5. **Submit under the lock:** `locks.ifAvailable(messageHash/txHash/index)`. Not acquired → "another tab". Acquired → `isExitWithdrawn` re-check → `withdrawOnL1`, which resolves after the receipt, so the lock spans "hash returned, not mined".
  6. **Stale proof:** `StaleProofError` rebuilds up to `MAX_PROOF_REBUILDS`.
- **Finish a withdrawal:** `exitTicketFromTx`. "not-found" gets plain copy; "all-consumed" means already withdrawn.
- **UI** (`src/components/bridge/`):
  - direction toggle and balances (L1 through the injected transport, L2 through granted simulations)
  - paused banner
  - deposit form → review with exact values, privacy copy ("hides who receives, not how much or when"), the unlimited-approval note and the keep-this-tab-open warning
  - withdraw form and finish form
  - steppers
  - deposit progress estimate; proving progress (`withdrawStatus`)
  - the fee-fallback dialog
- **Account switching:** the Aztec session's `isSwitchBlocked` reads the gate, so the selected account cannot change mid-send.

## Core changes

- `isExitWithdrawn(ticket, node, outbox)`: the per-occurrence consumed bit, for the in-lock re-check.
- `exitToL1` maps a sponsored send that the sponsor could not pay to `SponsorUnavailableError`, with nothing burned (the same rule as claims, via the shared `sponsorFailure`).
- **Bug fixed:** `withdrawStatus` called `getProvenBlockNumber()`, which the 5.2.0 `AztecNode` does not have. It now reads `getBlockNumber("proven")`, and its test asserts the tag.

## Attempts

1. **bb.js under jsdom.** `AztecAddress.random()` threw `BBApiException: std::bad_cast` in a jsdom test. bb.js's msgpack sees jsdom's `Uint8Array` as a foreign realm. Fix: the controller tests run with `@vitest-environment node` against real bridge-core (draft, typed data, pause re-reads). The component tests use `offlineDepositOps` (a fake draft and send) and an in-field address.
2. **Test address above the field modulus.** `0xabab…` is ≥ p; `0x0a0a…` is not.
3. **Function-size budget.** The first `createDepositFlow` factory ran to about 170 lines, because a closure's inner functions count toward it. Rewriting it as a class with private methods keeps every method small.
4. **Stepper cognitive complexity 17.** Moved the state and style choice into lookup tables and `stateOf()`.

## Self-review fixes, before commit

- A failed lookup from the `unconfirmed` screen went back to a blank form and lost the only copy of the burned exit's tx hash. It now returns to `unconfirmed` with the recovery details kept (test updated).
- A `failed` or `other-tab` withdrawal had no way out. It now has a "Close" button, and the ticket leaves the unload guard; it stays finishable from its details.
- The permit deadline counted from the L1 head alone. An idle local chain's stale head could have expired it before inclusion. It now counts from the later of the head and the wall clock; a later deadline only delays a "not deposited" verdict.

## Gate coverage (component tests)

| Required | Test |
|---|---|
| amount validation | `amount.test.ts`; `bridge.test.tsx` "validates the amount as typed…" |
| private mode never names the recipient | `deposit-flow.test.ts` "registers the draft before the signature, and a private deposit never names its recipient" (real typed data and calldata) |
| draft exists before `signTypedData` | same test (asserted inside the fake signer) |
| beforeunload registration/unregistration | `pending.test.ts`; the flow tests assert the guard empties on done/discard |
| fee fallback needs explicit confirmation | `deposit-flow.test.ts`, `withdraw-flow.test.ts`, `bridge.test.tsx` (dialog click) |
| confirm-time read failure → nothing signed | `deposit-flow.test.ts` (5 cases: balance, fees, pause read, paused, short) |
| pause during the wallet prompt → send refused | `deposit-flow.test.ts` "refuses the send when the bridge pauses while the wallet prompt is open" |
| withdraw form refuses the portal | `bridge.test.tsx` (UI); `withdraw-flow.test.ts` (portal, router, zero) |
| Web Lock held across hash-returned-not-mined | `withdraw-flow.test.ts` "holds the tab lock until the withdrawal's receipt…" |
| stepper transitions from a fake core | `deposit-flow.test.ts` step sequence; `bridge.test.tsx` "moves the stepper with the flow…" |

## Gate evidence

- `bun run lint`: exit 0.
- `bun run typecheck`: exit 0.
- `bun run --cwd apps/web test:components`: 10 files, 72 tests passed.
- `bun run test` (every workspace): exit 0. bridge-core 117 pass.
- `BRIDGE_MANIFEST=apps/web/src/test/manifest.fixture.json bun run --cwd apps/web build`: exit 0.
- Literal `bun run --cwd apps/web build`: exit 1, because `deployments/testnet.json` is absent (Phase 7).

## Gate after the arc 4 split (2026-09-29): the build now uses the fixture manifest, per the revised gate

- `bun run lint && bun run typecheck && bun run --cwd apps/web test:components && BRIDGE_MANIFEST=apps/web/src/test/manifest.fixture.json bun run --cwd apps/web build`: exit 0 (93 component tests pass, 1 skipped).
