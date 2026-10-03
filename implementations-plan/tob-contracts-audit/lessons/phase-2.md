# Phase 2: six refusal tests (F-2)

## Tests added

- `token_bridge/src/test/ownership.nr`: `non_owner_cannot_transfer_ownership`, `ownership_cannot_go_to_the_zero_address`, `non_owner_cannot_cancel_an_ownership_transfer` (a transfer pending, so only the owner check can refuse), `cancel_refuses_with_nothing_pending`.
- `token/src/test/merchants.nr`: `propose_merchant_admin_is_admin_only`, `sync_merchant_delay_is_admin_only` (on listed `m1`, so the registration check cannot refuse).
- Manifests and floors: bridge 74 → 78, token 162 → 164. `test:noir`: token 164 named tests, bridge 78, keystone 20, all passing.

## Kill proof

Tests committed first (`c9b9c9b`). Each refusal deleted from the production source alone (the token's two by deleting that function's `_assert_merchant_admin()` call, never the shared assert), the crate rebuilt with `compile.sh <crate>`, only its new test run, then `main.nr` and every `target/` restored with `git restore`.

```
killed propose_admin_call: propose_merchant_admin_is_admin_only fails (exit 1)
killed sync_admin_call: sync_merchant_delay_is_admin_only fails (exit 1)
killed transfer_owner_check: non_owner_cannot_transfer_ownership fails (exit 1)
killed transfer_zero_check: ownership_cannot_go_to_the_zero_address fails (exit 1)
killed cancel_owner_check: non_owner_cannot_cancel_an_ownership_transfer fails (exit 1)
killed cancel_pending_check: cancel_refuses_with_nothing_pending fails (exit 1)
restored: no drift from HEAD under contracts/aztec
```

Every failure reads `error: Test passed when it should have failed`: the deleted refusal let the call through, not some other error.

## Notes

- Never run anything that reads `contracts/aztec/*/target` (typecheck, `bun run test`, TXE) while `compile.sh` (including `--check`) is running: it rebuilds the artifacts in place, and bridge-core's typecheck failed with "Cannot find module …/merchant_token-Token.json" mid-build. Sequence them.

## Gate

After the kill proofs: `git diff --quiet HEAD -- contracts/aztec` (exit 0), `bash contracts/aztec/scripts/compile.sh --check` (exit 0), `bun run test:noir` (exit 0: token 164, bridge 78, keystone 20). Passed 2026-10-03.
