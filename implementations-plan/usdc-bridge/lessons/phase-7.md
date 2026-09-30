# Phase 7 — testnet deploy + Node smoke

## Status

**Done on Aztec 6.0.0-rc.1** (arc 4, after the Phase 11 re-pin). The arc-2 blockers are gone: the L1 key now holds 31.7 Circle Sepolia USDC and 4.38 ETH, and Sepolia's canonical rollup (`2914217885`) runs v6.

## Arc 4 run (v6 testnet, 2026-09-29)

- `probe:testnet`: 18/18. The fee budget now also counts the six standard-contract publishes: 213 FJ against a 1000 FJ faucet mint.
- `deploy:testnet` took about 12 min with real proofs, most of it waiting for the Fee Juice bridge (1000 FJ) to become consumable. It published AuthRegistry, PublicChecks and HandshakeRegistry, since v6 testnet had none of them, and verified every read-back.
  - L1: portal `0x1CfC6f52…e068`, router `0x29B3298E…4390`. Their runtime bytecode equals a fresh forge build (immutables masked).
  - L2: bridge `0x18ca27aa…3a27`, token `0x23cbbf3f…c555`, proxy `0x032ebe67…df4a`, owner `0x2341325d…008d`.
  - Sponsor: the canonical SponsoredFPC `0x06a9fa02…924b`, whose instance is published.
- `verify:testnet`: every check passed.
- `smoke:testnet` took 2 h 03 min, all four legs settled, each at +1.000000 USDC:
  - public deposit → claim, paid by the deployer; it waited for finality;
  - private deposit → claim, whose fee payer is the SponsoredFPC, topped up by 1000 FJ first;
  - public exit → withdraw on L1;
  - private exit → withdraw on L1.
- `secrets:scan`: `found=false`, `walletDirs=0`.
- `deployments/testnet.json` is committed. Its `l2.nodeUrl` is the dRPC endpoint, public config by the user's decision ([D29]).
- Pause-key reminder passed to the user: the L2 owner (pause/unpause) is `TESTNET_AZTEC_SECRET_KEY` in `.env.testnet`.

**Finality dominates the smoke.** A claim is done at `finalized`, and the testnet's finalized tip trailed the proven tip by about 30 blocks: the first claim was proven at block 1773 while finalized sat at 1771.

## Arc 2 codex loop

### Round 1 — session `01a0dfa9-be58-7391-bdb4-d53283546940` (GPT-6 Astra, high)

Verdict: "not ready to converge". 14 findings, each verified against the code before acting. Codex reproduced several of them with dummy values.

| # | Sev | Finding | Verdict and fix |
|---|---|---|---|
| F1 | H | Two concurrent `submitDeposit` calls both pass the `submission` guard. The one whose send is refused clears the other's record, which loses the recovery path. | **Accepted.** A module-level `WeakSet` in-flight guard is taken synchronously before the first await, so a second call throws at once. Only the owning call touches `submission`. Unit test: `Promise.allSettled` of two calls gives 1 sign and 1 send, and the record is intact. |
| F2 | H | `reconcileDeposit` never checks the chain. An injected provider that switches chains yields an empty scan, then `not-deposited`. | **Accepted.** The reader's chain is checked before and after the scan (`assertReaderChain`), and the draft's chain and router are checked against the manifest. A mismatch throws `NetworkMismatchError`, which keeps the draft; RPC failures still read as "pending". Unit test: the reader switches mid-scan. |
| F3 | H | viem follows nonce replacements, cancellations included, so a cancelled withdraw returns success. | **Accepted.** `withdrawOnL1` requires the Outbox's `MessageConsumed` for this leaf in the receipt, matched on message hash, epoch and leafId `2^pathLen + leafIndex`. It returns the mined hash, not the sent one. `MessageConsumed` was added to `OUTBOX_ABI`, pinned by `abi.test`. |
| F4 | H | Any "duplicate nullifier" error was read as `already-consumed`, and a caller may discard the secret on that verdict. | **Accepted.** `already-consumed` now needs the ticket's own nullifier in the L2 tree: `siloNullifier(bridge, poseidon2([messageHash, secret], MESSAGE_NULLIFIER))`, the same formula as aztec-nr's `compute_l1_to_l2_message_nullifier`. The secret is derived for private tickets. The formula is proven against the node in the integration spec (false before the claim, true after, for both kinds). `claim` takes a node. |
| F5 | H | Errors can print secrets: viem HTTP errors carry the RPC URL, and `Fr.fromHexString` echoes an out-of-field key. | **Accepted.** Keys are range-checked (secp256k1 n, Fr modulus) without echoing them. Every non-local CLI command re-runs itself as a child whose stdout and stderr are redacted line by line; pino and native writes bypass `console`, so only a pipe catches them all. The needles cover keys with and without 0x, and RPC URLs whole and by their credential-length parts. A caught error prints its cause chain, redacted. Unit test: a secret split across two writes is redacted, and the exit code survives. |
| F6 | M | `chain: null` disables viem's send-time chain assertion. | **Accepted.** Sends pass `sendChain(l1, m.l1.chainId)`: the wallet's own chain when it matches, else a bare definition of that id. `withdrawOnL1` rechecks the signing context after simulation, right before sending. `submitDeposit` reads the finalized block (and the reader's chain) before signing, so nothing is awaited between the post-sign checks and the send. |
| F7 | M | The Outbox checks the consumed bit before membership, so ticket B with a proof for already-consumed leaf A reads as "B withdrawn". | **Accepted.** `OutboxProof.exit` binds the proof to (messageHash, l2TxHash, messageIndexInTx). `withdrawOnL1` refuses a mismatch before touching L1. |
| F8 | M | A failure after the burn (`getTxEffect`) lost the L2 tx hash, and retrying would burn again. | **Accepted.** Every failure after the send becomes an `ExitUnconfirmedError` carrying `l2TxHash`, recipient and amount, which is exactly `exitTicketFromTx`'s input. The smoke stores it before rethrowing. |
| F9 | H | A leaderless group was assumed ours, and a `ps` failure took that path too. | **Accepted.** `processStart` separates "no such pid" from `ps` failure, which is thrown and treated as "unverified". A leaderless group is ours only if a member's `/proc/<pid>/environ` carries the group's `INFERENCE_MONEY_OWNER` marker. Ownership is rechecked before SIGKILL. A group left unverified or alive keeps the handle, and `netDown` throws instead of forgetting it. Unit test: an orphaned child with a wrong marker is "reused" and never signalled; with the right marker it is stopped. |
| F10 | M | A lock older than 15 s was treated as dead, and a live holder could lose it. The registry was also truncated in place. | **Accepted.** It stays the `ports.md.lock` file the host's other tooling takes exclusively (phase-5 finding 1). The lock now names its holder (`pid start-time`), published atomically by `link` from a temp file. It is stale only when that pid no longer runs with that start time; an unnamed lock (another tool's) goes stale after 120 s. The owner is re-read just before breaking a lock, waiters back off with jitter, and the lock is removed only if still ours. Writes go through tmp + rename. Unit test: an ancient lock held by a live pid is waited out, a dead holder's is broken, and no temp file is left. **Tried and reverted:** moving to the run-isolation skill's `ports.lock` `mkdir` convention would stop excluding the tools that actually share this file. |
| F11 | M | The handle was written only after both health checks, so an interrupted boot left detached services unowned. | **Accepted.** The handle is written before the first spawn and rewritten after each one, with `ready: false` until both services answer. `resolveEndpoints` refuses a handle that is not ready. |
| F12 | M | The smoke could report success without all four legs: resume skipped a missing private exit, and old records masked current ones. | **Accepted.** State is bound to the bridge address, and state for any other deployment is discarded. A fresh run clears it first. Each exit is stored before its checks, with a `verified` flag. Success requires both exits recorded, verified and withdrawn; otherwise the run says so and exits non-zero. |
| F13 | M | Every checkout shared the `testnet` forge dir. | **Accepted.** `testnet-<pid>`, removed once the artifacts are in memory. |
| F14 | L | Narration (`feeFor`, `assertAllPass`); a long FeeChoice paragraph; a false "old lock means dead owner" claim; process-ownership comments. | **Accepted.** All removed or rewritten. Comments were added on replacement receipts (F3) and on Outbox ordering (F7). |

Gate after the fixes: lint, typecheck and unit tests green (bridge-core 113, deployer 23, local-network 11). The redacted CLI path was exercised: `probe:testnet` 18/18, `secrets:scan found=false`. Integration run 5 (`0beccc70-it-592058`): 16 pass, 0 fail, 63 expect(), 469 s, clean teardown. It covered the real-node `isClaimConsumed` spec and every real `withdrawOnL1` event match. After switching the lock back to `ports.md.lock`, a `RUN_ID=lk` net:up → status → down cycle was clean: rows released, no lock or temp file left.

### Round 2 — same session, resumed with the `779fc23` diff

Codex: "Material findings remain—high confidence". 8 findings, each verified against the code:

| # | Sev | Finding | Verdict and fix |
|---|---|---|---|
| R2-1 | H | A provider could switch chains between `assertReaderChain` and the finalized read, then switch back. The wrong boundary becomes `fromBlock`, and a boundary above the tip scans nothing, then reports `not-deposited`. | **Accepted.** The submission records the boundary block's hash. At recovery the block at `fromBlock` must carry that hash on the reader's chain before any scan; otherwise `NetworkMismatchError` is thrown and the draft is kept. |
| R2-2 | M | The F7 label proved nothing. A relabelled proof, or a ticket whose recipient changed under the same hash, passed. | **Accepted, done differently.** Re-verifying Merkle membership in TS would duplicate stdlib's witness logic (which already checks the root against L1). Instead `buildWithdrawProof` freezes each proof and records it in a `WeakMap` against the exit it proves; `withdrawOnL1` accepts only such a proof for that exact exit, so a copy or edit is refused. It also recomputes the message from recipient + amount + manifest before any L1 call. |
| R2-3 | M | viem strips basic-auth userinfo from printed URLs, and short path keys slipped under the 16-char floor. | **Accepted.** The URL forms now include the normalized href, the URL without userinfo (with and without a trailing slash), the path + query at any length, the userinfo, and segments of 8+ chars. |
| R2-4 | M | Forwarded SIGTERM reached only the immediate child, and a surviving descendant kept `close` pending. | **Accepted.** The child leads its own group (`detached`, stdin ignored). Signals go to the group; after the child exits the group gets SIGTERM, then SIGKILL after 5 s if the pipes are still open; a wrapper failure kills it. Unit test: an orphaned `sleep 30` grandchild is reaped, and the wrapper returns in under 5 s (the old code would hang). |
| R2-5 | M | A leaderless member with a cleared or unreadable env counted as "reused", so teardown then forgot it. | **Accepted.** No observable marker now means "unverified"; "reused" requires another run's marker. Unit test: an `env -i` orphan is "unverified" and left alone. |
| R2-6 | M | Two waiters reclaiming the same stale lock could both enter, and preemption beats jitter. | **Accepted: stale locks are never broken here.** A lock whose named holder is dead fails fast with "remove that file and retry"; an unnamed one is waited out. **Rejected:** `flock(1)`. The host's other tooling locks by the file's existence (O_EXCL); a flock on that path neither excludes them nor survives their 15 s unlink-and-recreate. |
| R2-7 | M | `processStart` can throw after the spawn but before the handle records it, orphaning the group. | **Accepted.** On any inspection failure or timeout `spawnDetached` SIGKILLs the group it just created before throwing. Unit test: with `ps` unavailable the spawn fails and no `sleep 3141` survives. |
| R2-8 | M | A fresh run for a new deployment overwrote an older deployment's pending exit tickets. | **Accepted.** `adoptState` refuses, naming the file and the pending exit; only a fully withdrawn state of another bridge is discarded. |

Gate after the fixes: lint, typecheck and unit tests green (bridge-core 114, deployer 26, local-network 13). Integration run 6 (`0beccc70-it-614741`): 16 pass, 0 fail, 63 expect(), 465 s, clean teardown, no lock or registry rows left.

### Round 3 — same session, resumed with the `1e18181` diff

Codex listed two Medium findings, both reproduced. Everything else from round 2 held.

| # | Sev | Finding | Verdict and fix |
|---|---|---|---|
| R3-1 | M | `buildWithdrawProof` recorded `exitKey(t)` after its await. A caller changing `messageIndexInTx` mid-build got occurrence 0's proof trusted for occurrence 1, which surfaced as `AlreadyWithdrawnError`. | **Accepted.** The ticket's fields and key are read once, before the first await. `withdrawOnL1` copies the ticket on entry, so what is checked is what is sent. Unit test: the ticket changes while its proof builds, and the proof stays bound to the original occurrence. The `withdrawOnL1` doc comment, stranded above `assertProofFor` by the round-2 edit, was moved back. |
| R3-2 | M | Teardown finished when the pipes drained. A descendant ignoring SIGTERM with no pipe survived, and cancellation never escalated if the child ignored the signal. | **Accepted.** `reapGroup` sends SIGTERM, polls the group's liveness (`kill(-pgid, 0)`), and sends SIGKILL after 5 s. It runs on SIGINT/SIGTERM and after the child exits. The pipes then get a bounded wait and are destroyed. Unit test: a `trap '' TERM; exec sleep` descendant with ignored stdio is dead when the wrapper returns. |

**Round cap.** The plan stops at 3 rounds only when findings stay material. Severity and count fell every round (6 H + 7 M + 1 L → 1 H + 7 M → 2 M), and both round-3 fixes are narrow. As in Arc 1, both were fixed and one short confirmation pass closes the loop; anything material in it is surfaced, not fixed in a fifth pass.

### Confirmation pass — same session, resumed with the `bde58c4` diff

Codex: "No new material findings." The Arc 2 loop has converged. Integration run 7 on the final Arc 2 code (`0beccc70-it-631040`): 16 pass, 0 fail, 63 expect(), 486 s.

## Arc 3 before Phase 7

Arc 3 (web) is branched from the converged Arc 2 head while Phase 7 waits for funding. When the testnet run happens, its commit (`deployments/testnet.json` plus any fix it forces) lands on `usdc-bridge-core`, and `usdc-bridge-web` is rebased onto it locally; both branches are unpublished until Delivery. Any code change the run forces reopens the Arc 2 codex loop for that diff.

## Run 1 (2026-09-28): funded, then stopped by a canonical-rollup change

**Funding.** The user swapped 0.001 Sepolia ETH for 31.697366 Circle USDC on Uniswap v3 (tx `0xcd9b83c9e92f0ba47640e277b371ad4edd65cf830f619f9a81ae3ced5e3fc468`) with a one-off in-process viem script; the key never left the process and the script was deleted afterwards. The agent's own attempt was blocked by the auto-mode classifier as a real-world transaction, so the user ran it.

**Gate stopped at the probe; nothing was spent.** `probe:testnet` failed 3 checks:
- registry → rollup → inbox `0x816c…1E30`, outbox `0xb9da…DF0d`, version `2914217885`;
- the pins are rollup `1821665230` with inbox `0x3047…4f7c` and outbox `0x905f…42ff`.

**Facts (read-only reads on 2026-09-28):**
- The Sepolia Registry now lists 7 rollups. Index 6 (version `2914217885`, `0x8c2fb2A68A3d362ab1DE99E06F83f8903160BbD9`) is canonical.
- `https://v5.testnet.rpc.aztec-labs.com` still reports node 5.0.0 on rollup `1821665230` (`0xD73A…3178`).
- docs.aztec.network/networks still lists rollup `1821665230` for testnet, but gives the live version as 5.1.0.
- No public node answered for the new rollup at the obvious hostnames.
- There is no new aztec-packages release since v5.2.0 (2026-08-17).
- An aztec-node PR "setup testnet-v5" is open today, so the switch looks in progress.
- The probe passed on 2026-09-27, so the change is less than a day old.

**Why the probe is right to stop.** `TokenPortal.initialize` binds to `registry.getCanonicalRollup()`. A deploy now would send every deposit to the new rollup's Inbox, which the pinned node does not follow, so every claim would be impossible on the node the app uses. This is the plan's rollup-upgrade residual (accepted risk, deferred to mainnet), hit before the first deploy rather than after it.

**Held for the user:** wait and re-pin to the new rollup once a node serves it, or deliver with Phase 7 deferred. Either path is a user decision: it changes plan pins or the Delivery precondition.
