# Phase 2 — merchant list, rules, stamp

Status: **green 2026-09-30.**

## Gate evidence

- `noir-deps.sh` `--self-test`, fetch and `--verify`: 7 pinned entries.
- `compile.sh --check`: token `0x06b1fbd1…84a2` (new, the fork's), proxy `0x18d06d3b…af94` and bridge `0x2e9ade2e…96a3`, both equal to P1's, so I2 holds while they still build against npm's token.
- `bun run test:noir`: token 153 run / 152 named (floor 152), token_bridge 48, keystone 12.
- `bun run --cwd contracts/aztec test` (6 pass), `lint`, `typecheck`, `check-sole-consumer.sh` `--self-test` and the real check: all pass.
- The first run failed `typecheck` on `dispatch[0]` in the bytecode-bound test (`noUncheckedIndexedAccess`); `bun test` never typechecks, so only the gate saw it. Fixed with a non-null assertion after the length assertion.

## What was built

- **`contracts/aztec/merchant_stamp`** (lib): `stamp(c)` and `pad(c)`, their separators (`1404036670`, `3491815610`), and the side-hint capsule slot, all pinned literals the keystone re-derives.
- **`contracts/aztec/token`**, on top of the verbatim fork:
  - storage appended after upstream's fields (`merchant_admin`, `pending_merchant_admin`, `merchant_guardian`, `merchant_delay`, `merchants`, `merchant_off`); the three events; the MERCHANTS section (the admin functions, `is_merchant`, `get_merchant_status`, `get_merchant_roles`, `try_prove_merchant`);
  - the rule checks, first in each body: `transfer_private_to_private`, `transfer_private_to_public`, `transfer_public_to_private` and `transfer_private_to_public_with_commitment` prove a merchant side; `initialize_transfer_commitment` and `with_commitment` push the stamp or the pad; `transfer_private_to_commitment` proves the stamp or the payer; `transfer_public_to_commitment` checks the same in public;
  - `src/hints.nr`: the side hint (capsule first, else an anchor-block probe, counterparty first) and the rules it shares with the SDK.
- **Tests:** `merchants.nr` (29), `rules_private.nr` (15), `rules_requests.nr` (12), `hints.nr` (13) in TXE; four keystone tests; `abi-superset.test.ts` with the exact additions and the bytecode bound.
- **Upstream suite:** the only edit is that its four setup helpers list the accounts they create (owner, recipient) as merchants, through a new `list_merchants` helper. Every upstream test passes unchanged.

## Findings

1. **A soundness bug, caught in self-review before any commit.** The payment check proved the stamp for `FIRST` and the payer for `SECOND`, and the caller refused only `NEITHER`. The hint is unconstrained, so a prover returning 3 skipped both proofs and paid into any request. Now every value proves something or refuses (anything but `FIRST` and `NEITHER` proves the payer), the transfer check is total the same way, and the capsule passes out-of-range values through so `an_out_of_range_side_proves_the_payer_not_the_stamp` pins it: before the fix that test pays successfully. Lesson: an unconstrained selector must map every value of its type to a proof or a refusal, and the tests must be able to feed it one.
2. **I7 was wrong.** TXE executes the contract's private functions inside its server, so a Noir-side `OracleMock` never reaches the contract's oracles. The capsule path is still testable: a capsule stored through `private_context_at(token)` reaches later `call_private` executions, because the PXE's capsule service falls back from a tx's capsules to the contract's stored ones. A lying probe can't be staged (TXE answers its own oracles honestly), and a lie from either source reaches the same constrained code, so the lying-capsule tests cover it. The probe's choices are unit-tested by calling the hint directly in a private context at the token.
3. **I3 holds:** a private `#[view]` may read a DelayedPublicMutable (`try_prove_merchant`'s view tests pass).
4. **I5 holds:** the fork's public bytecode packs to 1,206 fields against upstream's 707 and the plan's 2,700 bound (the protocol's cap is 3,000).
5. **An `#[internal]` function cannot return a struct holding a `BlockHeader`**: the macro's entry-point type check rejects it ("Enum is not yet allowed as an entry point type"). `merchant_list` is a `#[contract_library_method]` instead.
6. **Deviations from the plan's text, all small:**
   - a new refusal, `Merchant is the zero address`, for `add_merchant(0)` (the plan asked for the check but listed no string); P3's `rules.ts` gets it;
   - `with_commitment` refuses with the transfer string (sender and recipient), `initialize_transfer_commitment` with the request string (creator and recipient);
   - `get_merchant_roles` also returns `guardian_delay`, so `verify` can read the guardian slot's delay without unpacking DelayedPublicMutable storage;
   - the capsule slot lives in `merchant_stamp`, next to the stamp, so the keystone can pin it; the keystone floor is 12 and the token's 152.
7. **TXE block timestamps never advance on their own**, so expiry edges are deterministic: a block mined at `change - 1` still sees a merchant, one at `change` sees a user.
8. `nargo fmt` reflowed one pre-existing keystone line; upstream token code is already format-clean, so formatting touches only fork code.
