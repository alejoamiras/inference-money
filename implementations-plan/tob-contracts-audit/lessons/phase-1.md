# Phase 1: the exits' payout rule (F-1)

## What changed

`contracts/aztec/scripts/check-sole-consumer.sh` gained `pays_recipient` (both exits) and `config_once` (all six checked functions), and ten self-test mutants.

## Kill proof

The self-test is the kill proof: each mutant is the real source with one substitution, and must be rejected for its own reason.

```
exit_public_unpaid → exit_to_l1_public does not pay the hashed withdraw to config.portal
exit_private_unpaid → exit_to_l1_private does not pay the hashed withdraw to config.portal
exit_pays_twice → exit_to_l1_public messages the portal more than once
exit_pays_portal → exit_to_l1_public does not hash withdraw(recipient, amount, caller_on_l1)
exit_drops_caller → exit_to_l1_private does not hash withdraw(recipient, amount, caller_on_l1)
exit_altered_hash → exit_to_l1_public alters its withdraw hash
exit_shadowed_hash → exit_to_l1_private rebinds content
exit_rebinds_recipient → exit_to_l1_private rebinds a parameter its withdraw hashes
exit_paid_in_branch → exit_to_l1_private pays out inside a branch
exit_redirected → exit_to_l1_private binds config more than once
✅ check-sole-consumer self-test passed (real source upheld; 45 single-rule mutants rejected for their own reasons)
```

The first two are the audit's surviving L2 mutants B34 and B43 (each exit's `message_portal` deleted), which passed every CI check before this phase.

## Notes

- `flow_is` must run before `pays_recipient` in `check_exits`. The `dead_branch` and `paren_branch` mutants insert `if false {` without a closing brace, so a depth check that ran first would reject them as "pays out inside a branch" rather than for their own reason.
- `exit_paid_in_branch` moves the pair into the existing `else` branch, the evasion `flow_is` alone cannot see (same branch conditions); a wrapping `if as_merchant { … }` would have been caught by `flow_is` anyway and proves nothing about the new rule.

## Gate

`bash contracts/aztec/scripts/check-sole-consumer.sh --self-test` (45 mutants), `bash contracts/aztec/scripts/check-sole-consumer.sh` (holds), `bun run lint` (exit 0). Passed 2026-10-03.
