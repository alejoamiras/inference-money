# Phase 5: L1 events, router guard, Slither (F-3, F-7, F-5)

## What changed

- `TokenPortal`: `PortalInitialized` (the whole binding, Outbox included) at the end of `initialize`, `Withdraw(recipient indexed, amount, callerOnL1)` after the exact-debit check; `callerOnL1` is computed once and feeds both the content hash and the event. `TokenPortal is ITokenPortal` (Slither `missing-inheritance`).
- `Permit2DepositRouter`: `ReentrancyGuardTransient` like the portal (F-7); the re-entry test now expects that guard's selector. The `reentrancy-balance` result on the pull check is suppressed inline with its reason.
- `TOKEN_PORTAL_ABI` gains both events; `abi.test.ts` pins them against the forge ABI (4 pass).
- Slither 0.11.6: `scripts/slither.sh` (builds `src` only into a per-run dir), `slither.config.json` (excludes `naming-convention`, filters `node_modules`), `test:evm:slither`, hash-locked install in `setup-toolchains`, a step in `_contracts.yml`.
- Docs: `integration.md` "Following the contracts" (every event an indexer needs, and the constructor state as baseline); assurance map A4 (`Withdraw`), A28 (`PortalInitialized`, and the wording narrowed: only events that replace a holder name it).

## Gas

`.gas-snapshot`: `test_gas_depositPrivate` 594 296 → 590 426, `test_gas_depositPublic` 596 706 → 592 836 (−3 870 each: the transient guard replaces the storage one).

## Kill proofs

Each mutant applied to the source, only the named tests run, then restored (`cmp` against a saved copy).

| Mutant | Result |
|---|---|
| delete `emit Withdraw` | killed: `Transfer != expected Withdraw` (`test_withdraw_consumesAndDebitsExactly`) |
| `Withdraw` names `msg.sender` instead of `callerOnL1` | killed: `param mismatch at callerOnL1: expected=0x0…0` (the without-caller withdraw) |
| `Withdraw` amount 0 | killed: `param mismatch at amount: expected=200, got=0` |
| `PortalInitialized` never emitted | killed: `log != expected log` (`test_initialize_refusesARouterBoundElsewhere`) |
| `PortalInitialized` names the Inbox as the Outbox | killed: `param mismatch at outbox` |
| router without `nonReentrant` | killed: `re-entry allowed: 0xfb8f41b2… != 0x3ee5aeb5…` (`test_reentryFromTokenHookRefused`) |
| inline `slither-disable-next-line reentrancy-balance` removed | killed: `test:evm:slither` fails on `reentrancy-balance` |

`ITokenPortal` inheritance needs no test: a signature drift fails the build.

## Gate

Combined with Phase 4 (see `phase-4.md`): every step exit 0, `test:evm` 81 passed (the event checks are assertions in existing tests), `test:evm:formal` "exactly the 11 expected proofs passed", `test:evm:slither` 0 results, `test:integration` 44 + 4 pass.

## Notes

- **Slither flagged the new event.** `PortalInitialized` had address parameters and none indexed (`unindexed-event-address`). Fixed by indexing `underlying` (an indexer finds every portal for a token; topic0 is unchanged), not by a suppression. After it: `0 result(s) found`, exit 0.
- `slither` comes from the validated venv in this session (`PATH` prepended); CI installs it from the hash lock.
