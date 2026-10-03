# Phase 3: the plan for expiring, pay-once stamps

Gate (2026-10-02): both gating verdicts are explicit approvals, their conditions written into `plan.md`.

- Opus 5.5 `Plan` agent: "VERDICT: approve with conditions" (six conditions).
- Codex, fresh context, on the revised plan and its ledger: "VERDICT: approve with conditions — adopt findings 1 and 2 in writing before implementation."

## The consults

| Round | Reviewer | Verdict | What it turned on |
|---|---|---|---|
| Dual audit | Codex (default model, `medium`) | reject, with a stated path to approval | The 23 h baseline unproven; a 300 s margin; tests that stop at the pre-checks |
| Dual audit | Opus 5.5 | approve with conditions | The merchant payer's side contradicted itself; no test saw the cap by value |
| Round 2, same Codex session | Codex | approve with conditions | Its three blockers resolved; replacement of a stale request could double-pay; file order is not isolation |
| Fresh pass | Codex, new session | approve with conditions | `stale` must go only to the reservation's owner; the clock run must refuse an attached network |

The first reject was read as feedback to iterate on, as `/blueprint mid` prescribes, because it named what would turn it into an approval and every item was adoptable. The plan's gate is the fresh-context verdict and the Opus verdict; the owner sees the reject and this reading in the final report.

## What bit

- **The reviewer was wrong on the main blocker, and only the source settled it.** Codex read `scheduled_value_change.nr:83` (`anchor + minimum_delay`) and concluded an ordinary tx lives 24 h. The `minimum_delay` passed in is the effective one, and `scheduled_delay_change.nr:178` returns `delay - 1`. The kernel takes that horizon for every private call's contract-update read, so every tx is capped at `anchor + 86399` and the PXE rounds it to 23 h. [A21] had measured the result without anyone tracing the cause.
- **A draft's "one more pinned slot is not worth it" reversed on testability.** Without a bucket capsule nothing can hand the circuit a wrong bucket, so the constrained binding of stamp and deadline had no test. The capsule also spares SDK payers the in-circuit probe.
- **TXE checks no tx's expiry and runs the compiled artifact.** A TXE test passes with `set_expiration_timestamp` deleted, and tests run before `compile.sh` test the old contract.
- **`compile.sh --check` compares against `HEAD`.** A phase that rebuilds artifacts must commit before its gate.
- **A heredoc after `cat > /dev/null;` hangs the shell** (it waits on stdin). Write scripts with the file tool and run them by path.
- **The Noir scripts need `NARGO` on this host.** No aztec-up install of the pinned version exists here; the sha-verified `nargo 1.0.0-rc.3` CI uses is cached under `~/.cache/inference-money/nargo-1.0.0-rc.3/` and `NARGO=<that>/nargo` selects it. `compile.sh --check` passes on the untouched tree with it.
- **The node's debug API moves a local network's clock.** `aztecDebug_warpL2TimeAtLeastBy` on the node's own URL; warps of 26 h and 1 h each built the next block on a bare network. It lands on a slot boundary, not the second asked for.

## Decisions

Recorded in `plan.md`'s decision ledger, each with its source.
