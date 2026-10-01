# Phase 8 — Operator CLI, keyed runs, demo, acceptance run

Status: **in progress** (gate rerun after the codex round-1 fixes).

## Gate evidence

- Line 1 on 50c58d3 plus part of the round-1 fixes: build, lint, typecheck, unit (deployer 38) and integration 42/42 (1172 s) — `P8 GATE LINE 1: PASS`. Rerun after the fixes below.

## Findings

1. **One owned tmp scope per process.** `withOwnedTmpDir` refuses to nest, and the integration harness holds one for the whole suite, so the operator spec drives the CLI as a subprocess, as an operator would. Wallet-less checks (`verifyDeployment`, `readBundle`) and a second wallet opened inside the harness's scope run in-process.
2. **A local heartbeat needs a wallet of its own.** Beats sent through the session's wallet land in its record of sent txs, which the smoke uses to prove a refused step sent nothing and to journal each step's tx. `withHeartbeat` opens a second wallet in the same scope.
3. **`set_merchant_delay` reschedules the guardian slot itself**, so an unsynced setting shows on the listed entries only. The plan's "guardian slot below the setting" drift is unreachable through the admin's API; `verify` still checks the slot.
4. **A request's commitment cannot be read back from its tx** (it arrives as an offchain effect of the send), so the smoke re-opens a request it never recorded. A lost payment keeps its request: the journal and the payment gate share one rule (`finalFate`), so once finalized blocks prove the payment gone, the gate releases that same commitment.
5. **A deposit draft is persisted at the `depositing` stage**, the moment its `submission` is recorded and before the send, so a crash between them recovers it with `reconcileDeposit` instead of depositing twice. The ticket codec gained a `draft` kind for it.
6. **The secrets scan.** A first version walked `git ls-files` plus every file under `~/.cache/inference-money`: it read the disposable keys' own file (a guaranteed hit for every `disposable exec`), descended into gigabytes of installed dependencies, skipped ignored checkout files, and dropped files over 64 MiB silently. It now walks the checkout and the caches itself, ignored files included, prunes `node_modules`, `.git` and the disposable directory before descending, reads in 8 MiB chunks overlapping by the longest needle, and fails on anything it could not read.
7. **The CLI's handler map is total** (`Record<Command, Handler>`), so a command without a handler fails the typecheck; the runtime coverage test went.
8. A first draft of the drift spec chained every drift in one test, so a failed expectation left the delay changed and failed the next spec. Each drift now undoes itself in `finally`.
9. **`Bun.spawn` ignores `process.env` deletions** (Bun 1.4.0): without an `env` option it passes the environment the process started with. `node:child_process` and `Bun.$` honor them. `holdSecrets` therefore protects children only while every runtime spawn goes through `node:child_process` (true today; bb.js spreads `process.env` at spawn time, after the hold).
10. **A node's "dropped" is not "gone".** `getTxReceipt` answers DROPPED for any hash the node's own pool lacks, while another node may still include the tx until its expiry; a reverted or included tx short of finalized can be pruned. Only finalized evidence settles a sent tx.

## Codex, arc 4 round 1 (session 01a0f5a6-5c37-7972-bf7f-ea46ac46a7ed, GPT-6 Astra high)

Verdict: changes requested, nine findings. Each, and what was done:

1. **High, handover recorded before finality.** Accepted in part. `admin accept` now waits for its checkpoint, reads both roles back before writing the manifest, and is idempotent: a rerun after a crash, or after a prune that left the handover pending, completes it, and `verify` flags a manifest naming an admin the chain does not. Not a finalized wait: a pruned accept is recoverable that way, and the one irreversible step, deleting the disposable keys, waits for finalized evidence instead (2).
2. **High, `destroy` could erase keys that still control the deployment.** Accepted. `disposable destroy <manifest>` reads the bridge's owner and pending owner and the token's merchant admin and pending admin at the last finalized block, and refuses while either disposable account holds or is offered one.
3. **Medium, the lock admitted two holders.** Accepted with another fix: Bun and Node have no OS-held file lock without native code. The lock is now a file holding its pid, linked into place whole, so it never exists empty; a stale lock is moved aside and put back if it names a live process; release removes only its own. Residual: three processes contending within the same instant could still double-hold.
4. **Medium, "dropped" justified a resend.** Accepted (finding 10). `finalFate` in bridge-core backs the payment gate and the smoke journal; the smoke fails with when to rerun while the chain cannot tell. Its stale-next-step bug went with the request re-open it lived in (finding 4).
5. **Medium, credentials reached grandchildren** (bb's native backends spread `process.env`). Accepted: the redacted child calls `holdSecrets` before any handler, every reader takes the held values, and `disposable exec` passes each command only the values it needs. Finding 9 came out of its test.
6. **Medium, the scan could certify clean output falsely.** Accepted in part (finding 6). Rejected: scanning `node_modules`. Dependencies are installed keylessly before any run, and one compromised at runtime can exfiltrate over the network, which no scan stops.
7. **Medium, the guardian could not use `merchants cancel`.** Accepted: it signs with the supplied secret, and the token decides.
8. **Medium, setup dropped the float's claim secret before its claim finalized.** Accepted: every seed's claim is kept until finalized.
9. **Low, comments.** Accepted: plan references and signature restatements removed, the secrets and write guarantees corrected (writes now fsync the file and the directory).
