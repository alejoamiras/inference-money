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
| S4 delay globals in `hints.nr` | **Deferred to P8's first step.** | Only Arc 3 depends on it. Moving and reverting Noir sources mid-Arc 1 risks a stray edit in an Arc 1 commit. |
| S5 TXE expiry read | **Deferred to P8's first step.** | Same reason; it decides only SP-34's layer. |
