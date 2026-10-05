# Phase 0: spikes (2026-10-04)

Scratch projects only, under the session scratchpad; nothing committed.

| Spike | Result | Consequence |
|---|---|---|
| S1 Medusa 1.5.1 `vm.addr` / `vm.sign` / `vm.prank` | **yes**. A handler signed with `vm.sign(pk, h)`, `ecrecover` returned `vm.addr(pk)`, and a pranked call saw `vm.addr(pk)` as `msg.sender`. | Fizz key-holder actors work as planned. |
| S1 Medusa CLI over `--config` | **yes**. `--timeout 25 --test-limit 0` overrode the config's `testLimit: 500` (about 95k calls in 21 s). | `test:evm:fuzz` passes both flags; `medusa.json` keeps its local defaults. |
| S1 failure exit code | **7** on a failed property; the summary prints `N test(s) passed, M test(s) failed`. | The nightly job fails on a nonzero exit. |
| S2 halmos 0.3.3 through OZ `ECDSA.recoverCalldata` | **Partial.** The positive proof passes: a low-s `vm.sign` by the depositor is accepted. The foreign-signer refusal **fails**: `f_ecrecover` is uninterpreted, so the solver finds paths where a foreign signature recovers to the victim, or recovers to zero (`ECDSAInvalidSignature`), even with `vm.addr(other) != vm.addr(pk)` assumed. | Plan fallback: signer rules are forge mutant canaries. Halmos keeps the structural rules (zero, canonical, refund address, deadline, router-only). Router proofs pin `isPrivate = false`. |
| S3 designator etch under `cancun` | **yes**. A 23-byte `0xef0100‖delegate` gives the account code, and `prank` still works. | As planned. |
| S3 delegate runtime etched at the key-held account | **yes**. `isValidSignature` runs as the account (`address(this)` == the account). | Kept as the fallback. |
| S3b real 7702 under the repo's `cancun` pin | **yes, without Prague.** In forge 1.7.1, `vm.signAndAttachDelegation(delegate, pk)` followed by a call to the account executes the delegate, with the identical result under `--evm-version prague`. | The fork and unit 7702 tests use real delegation (`vm.signAndAttachDelegation`), not etching. The compile target stays `cancun`. |
| S4 delay globals in `hints.nr` | **Yes** (2026-10-05, P8's first step, in a scratch copy): with `MERCHANT_{MIN,MAX}_DELAY` moved to `hints.nr` and imported by `main.nr`, `nargo check` passes and the `#[storage]` generic `DelayedPublicMutable<bool, MERCHANT_MIN_DELAY, Context>` accepts the imported global. | No duplicated literal; the fallback was not needed. |
| S5 TXE expiry read | **Yes** (2026-10-05): inside `private_context_at`, `DelayedPublicMutable::new(context, slot).get_current_value()` then `context.finish().expiration_timestamp` reads the cap the token's read sets; for a pending delay decrease two hours in it equalled the hint's horizon exactly (anchor + 79 199). A full `call_private` cannot expose it: TXE runs no kernel and ignores a tx's expiry. | SP-34 is a TXE test at the entry level, not the partial integration fallback. |
