---
plan: harden-security-whole-repo
driver: claude-code
eli5_mode: artifact
code_review: off
claude_model: opus
codex: default model, medium effort
baseline: 9f84cdb
status: closed 2026-10-03, completed (see Outcome)
---

## Outcome

**Closed 2026-10-03: completed.** The three-PR stack below awaits the owner's merge. This plan is now a historical record. The `/goal` seed under **Seeds** is retired: do not run it, and do not treat any section below as a task list.

**Shipped**, as a stack on `main` (`gh stack merge --squash` on the top PR lands it all):
- #18 `fix`, arc 1: the audit's chosen fixes (C-001, C-002, C-004, C-005, C-006, C-009, C-012 docs, C-013's guardian half, C-014, C-015, C-016), the CLI's `--no-env-file`, and the three routed bugs (process groups owned from any time zone, a reverted exit final only once finalized, the launcher's anvil off port 8545).
- #19 `feat(token)`, arc 2: C-017 as the owner decided. Stamps carry their opening's hour and expire 24 h to 25 h later, a request takes one payment, bridge-core refuses a marked (stale) private payment and shares one replacement per stale request.
- The docs-only close-out on top: this Outcome, the promoted lessons and follow-ups, and the archive move.

**Accepted with no change**, by the owner: C-003, C-007, C-008, C-010, C-011, and C-013's accept-time half.

**Reviews:** the stamp plan's gate was Opus 5.5 and a fresh Codex session, both "approve with conditions"; Codex's first audit rejected with a path to approval and was iterated on ([phase-3](lessons/phase-3.md)). Fix loops: arc 1 converged in round 3 (a fourth, on the later wrangler fix, found nothing), arc 2 in round 3, the cross-arc pass in round 2 ([phase-2](lessons/phase-2.md), [phase-5](lessons/phase-5.md)).

**Changed, dropped or deferred, and why:**
- **[A22]'s rewrite moved into Phase 4:** its old case asserted the double payment the token now refuses.
- **The review loops added a `replaced` record** to the payment store, beyond the plan: attempts that meet one stale request share its replacement.
- **Not deployed:** the stamp change is code only. Testnet runs the old token until the owner redeploys (a keyed run).
- **Deferred** (open in `implementations-plan/follow-ups.md`): the testnet redeploy with the new token.
- **wrangler moved to the root:** locked first in `apps/showcase`, it broke Workers Builds, whose dashboard command runs `npx wrangler@4.138.0` from the root ([phase-1](lessons/phase-1.md)). At the root that command runs the locked copy, so the dashboard needs no change.

# Harden pass: the fixes, then expiring pay-once stamps

The 2026-10-02 whole-repo security audit (17 findings: 0 Critical, 0 High, 3 Medium, 14 Low) and the owner's decisions on it, delivered as two stacked PRs and a close-out. The audit's own output (`audit/security/2026-10-02-whole-repo/`) is git-excluded and lives only in this worktree; its stakeholder report is a private Artifact.

## Owner decisions (2026-10-02, all asks answered)

- **Rule for this list:** no defence against a dishonest node or RPC unless it is about one line; a loss a caller inflicts on itself by bypassing the SDK is the caller's.
- **Fix:** C-001 (bind the pinned registry), C-002 (CSPRNG secrets, refuse `SEED`), C-004 and C-015 (one-liners), C-005 and C-012 (docs only; the portal keeps its function names), C-006, C-009 (hash-lock halmos, lock wrangler), C-016, C-014 (docs and runbook; the guardian stays in the token).
- **Keep** the `verify` guardian check (`--guardian`, none by default). **Add** `--no-env-file` to the operator CLI.
- **C-017:** stamps expire after 24 h, and a request is payable once. The self-shield stays as it is, bounded by the expiry. Code only: no testnet redeploy in this plan.
- **Accepted, no change:** C-003, C-007, C-008, C-010, C-011 (downgraded: a showcase web app), the accept-time half of C-013.
- **Routed bugs:** fix all three (teardown under a changed time zone, a reverted exit reported final too early, the second anvil on port 8545).
- **Process:** the fixes need no blueprint: one PR, one Codex loop. The stamp change gets `/blueprint mid`, run inside the cycle: open questions are settled with Codex and logged, and implementation starts when Codex and the Opus 5.5 audit both return an explicit `approve`. A `reject`, or a disagreement the two cannot settle, stops the cycle for the owner. Reviewers: Opus 5.5 and Codex on its default model at `medium`. `/code-review` is off. Merging is always the owner's.

## Outcome & Quality Bar

- **For whom:** the operator running `bun run bridge` with keys, an integrator paying requests through bridge-core, and the owner deciding what goes to mainnet in a token that cannot be upgraded.
- **Excellent:**
  1. After a switch-off lands, no payment that relies on a stamp for that account can be included more than 25 h later (the entry's delay plus 25 h after the switch-off is scheduled); a merchant payer never relied on the stamp. A test proves the bound on a real network, not only in TXE.
  2. A private payment anchored within 1 h of its request's opening anchor commits the same expiry as a transaction that reads nothing, `anchor + 82800`; the expiry spec asserts that number and the payment's parity with it, across an hour boundary too.
  3. A second payment into one request cannot land. Sent after the first, it is refused with a string exported from `rules.ts` through both paths; racing the first, the protocol's nullifier uniqueness lets one of the two in, which a test observes.
  4. Every operator-facing message and doc sentence touched says what the command did or what a pass proves, with no claim wider than the code.
- **Good enough:** no new configuration surface, no defence the owner declined, no change to accepted findings, upstream signatures untouched.

## Phases

### Arc 1: `harden-fixes` (branch `worktree-harden-security-whole-repo`)

#### Phase 1: the fixes already in the working tree ✓

C-001 (`packages/deployer/src/deploy.ts`, `testnet.ts`), C-002 (`packages/bridge-core/src/random.ts`, `deposit.ts`, `packages/deployer/src/disposable.ts`, `cli.ts`, two tests), C-004 (`admin.ts`, `commands.ts`), C-015 (`verify-cli.ts`), C-013 guardian check (`verify.ts`, `verify-cli.ts`, `cli-args.ts`, `commands.ts`, `packages/integration/test/operator.test.ts`), C-006 and C-016 (`.github/workflows/`), C-009 (`.github/actions/setup-toolchains/`, `apps/showcase/package.json`, `bun.lock`), docs for C-005, C-012, C-014, C-017 (`docs/`, `packages/deployer/src/export.ts`, `packages/bridge-core/src/payments.ts`). Review the diff once as a whole, then commit it in focused conventional commits.

**Validation gate.** Commands: `bun run lint && bun run typecheck && bun run test && bun run lint:actions && bun run test:evm:formal`. Pass: all exit 0; the halmos gate prints "exactly the 11 expected proofs passed". Layers: lint, typecheck, unit, formal.

#### Phase 2: `--no-env-file` and the three routed bugs ✓

- `--no-env-file` on the operator CLI's scripts (`package.json`: `bridge`, `secrets:scan`, and any script that runs `packages/deployer/src/cli.ts`); the keyed-run and disposable re-exec paths (`packages/deployer/src/redact.ts`, `disposable.ts`) must pass it too, or a child loads the file its parent refused. A test proves a `.env` in the working directory no longer reaches the CLI.
- Teardown under a changed time zone: `packages/local-network/src/process.ts:20-23`, `:67-68`, `network.ts:198` compare `ps lstart` text. Compare a time-zone-independent start time; unprovable still means untouched.
- A reverted exit reported final too early: `packages/bridge-core/src/exit.ts:173-179`, `return.ts:98`. Report a revert as final only on finalized evidence, as payments already do (`finalFate`); check the showcase's use of the result.
- The second anvil on port 8545 from the pinned launcher: confirm by running a local network. Fix in the repo if a supported option exists; otherwise document it in `docs/` and add it to `implementations-plan/follow-ups.md`. Do not patch the pinned dependency.

**Validation gate.** Commands: the Phase 1 gate, then `bun run test:integration`. Pass: all exit 0. Layers: lint, typecheck, unit, formal, integration on a local network.

**Arc 1 quality loop:** the Codex fix loop of the Post-implementation section, over the arc's diff, before `gh stack add`.

### Arc 2: `expiring-stamps` (branch `harden-expiring-stamps`, stacked on arc 1)

#### Phase 3: the plan (`/blueprint mid`, inside this file) ✓

Run the blueprint's recon, draft with a competing outline, dual audit (Codex and an Opus 5.5 `Plan` agent), decision ledger and a fresh Codex pass, and write its Architecture & Implementation, Security, Assumptions and its implementation phases (Phase 4 onward, each with a gate) into this file. Publish the plain-language summary as an Artifact and record its URL here. Evidence to start from: the audit's `report.md` (C-017) and `findings/verify/S-001-{claude,codex}.md`.

Fixed inputs, not open for redesign:
- Lifetime 24 h; pay once; self-shield unchanged; upstream signatures unchanged (`contracts/aztec/scripts/abi-superset.test.ts`).
- A payment anchored within 1 h of its request's opening anchor must commit the standard expiry (`anchor + 82800`): the PXE rounds an in-circuit cap down from the anchor to whole hours (`@aztec-labs/pxe` `src/private_kernel/hints/compute_tx_expiration_timestamp.ts`). So a stamp needs at least 24 h left when opened, whatever the bucket size; state the resulting worst-case tail exactly (it may be 25 h, not 24).
- bridge-core's `payRequest` refuses a request too old to pay unmarked, before anything is proven.
- Pay-once: both payment entry points emit the same commitment-derived nullifier; a zero-amount private payment must not be able to burn a request.

Questions the plan must answer: how the payer learns the stamp's time bucket (carried with the request, or probed); whether opening needs any new expiry cap; what an expired or already-paid request looks like to each client; which refusal strings are added.

**Validation gate.** Pass: Codex's fresh-context verdict and the Opus audit's verdict are both an explicit `approve` (a conditional approve counts once its conditions are written into the plan), quoted in the transcript; every implementation phase added carries a gate from this repo's real commands.

**Passed 2026-10-02.** The Opus 5.5 audit: "VERDICT: approve with conditions". Codex's fresh-context pass: "VERDICT: approve with conditions — adopt findings 1 and 2 in writing before implementation." The first Codex audit rejected the draft and, resumed on the revision, found its three blockers resolved and approved with conditions. Every condition is in the plan; the decision ledger maps each finding to what it became.

#### Phase 4: the token's rule and its mirrors ✓

The design is under Architecture & Implementation, Arc 2. In order, validating the fast layers after each step:

1. `contracts/aztec/merchant_stamp/src/lib.nr`: the bucketed stamp, its deadline, the paid marker and its separator, the bucket capsule slot. The keystone derives, pins and separates the new separator, derives and pins the slot, and gains vectors for `stamp(c, b)` and `paid(c)`.
2. `contracts/aztec/token/src/main.nr` and `hints.nr`: the opening's bucket, the private payment (side and bucket by the order, pre-check, deadline assert, cap, zero check, paid marker), the public payment (merchant first, live-stamp search, paid marker).
3. `bash contracts/aztec/scripts/compile.sh`: TXE deploys the token from its compiled artifact, so the tests below mean nothing before this. Then the class id in `packages/bridge-core/src/artifacts.test.ts`.
4. TXE tests in `rules_requests.nr` and the hint tests, each new name in the crate's `txe-manifest.txt` and both floors raised. TXE's clock starts at the wall clock and never moves by itself, so every test derives its bucket from `last_block_timestamp()` and sets later times with `utils::anchor_at`. TXE checks no tx's expiry, so nothing here observes the cap; the integration spec does:
   - an opening pushes the stamp of its anchor's bucket (the existing stamped and padded tests, through the helper);
   - privately, a user pays at an anchor equal to the deadline and is refused one second later; with no capsule that refusal is today's string (the probe no longer finds the stamp), and with a capsule naming the expired stamp's bucket it is "the request's stamp has expired";
   - a capsule naming a bucket other than the stamp's is refused;
   - the hint's order, called directly as the existing probe test does: a fresh stamp gives the stamp for any payer; a live one no longer fresh gives the payer for a merchant and the stamp for a user; none live gives the payer for a merchant and nothing for a user;
   - publicly, a user pays a request whose stamp sits in the oldest live bucket (the search's longest successful path) and is refused once it is no longer live;
   - a merchant pays a request whose stamp expired, privately with no capsule and publicly;
   - a second payment is refused: private then public, and public then private;
   - a private payment of zero is refused;
   - `a_request_stamped_for_a_merchant_stays_payable_after_its_switch_off` is renamed "…until its stamp expires" and gains the refusal after the deadline.
5. bridge-core: `stamp.ts` (the mirror and `bucketCapsule`, with the keystone's vectors in `stamp.test.ts`), `rules.ts` (three strings), `merchants.ts` (`paymentSide` by the order, its tests extended), `payments.ts` (`requestStamp` in place of `isStamped`, the `stale` refusal before proving and at the gate, the header), and every caller of what changed, so the workspace still typechecks. Unit tests: `requestStamp` returns the newest live bucket from one node call; a fresh stamp pays with both capsules; a stale one is refused for a user's private payment, paid by a merchant's own proof, and paid publicly; the gate refuses a stamp-side payment whose committed expiry fell under the standard between the check and the send, and releases the reservation; the existing supersession test (`payments.test.ts:235`) gains the case where the superseded attempt resumes onto a stale stamp and must answer `in-flight`, not `stale`; the existing lost-payment test (`payments.test.ts:184-203`) asserts the reservation's release on its own, without re-paying a request that is by then 25 h old.
6. Commit the rebuilt artifacts with their sources: `compile.sh --check` compares a fresh build against `HEAD`, so it can only pass after that commit.

**Validation gate.** Commands, after step 6's commit: `bash contracts/aztec/scripts/compile.sh --check && bun run test:noir && bash contracts/aztec/scripts/check-sole-consumer.sh && bun run lint && bun run typecheck && bun run test`. Pass: all exit 0; `abi-superset.test.ts` reports no added function, storage or event and the bytecode under its ceiling. Layers: lint, typecheck, unit (TS, TXE, keystone), the artifact-equals-source check.

#### Phase 5: clients, a real network, docs ✓

1. `packages/integration`, on the harness's network with real kernels and a real PXE:
   - [A22] in `requests.test.ts`, rewritten: a second payment is refused through both paths with the exported string, and the siloed `paid(c)` leaf is on chain after a private-only payment and after a public-only one (two requests).
   - Contention, in the same spec: a private and a public payment into one unpaid request, funded independently (the payer's private notes, its public balance), proven against the same state and sent back to back with `sendTogether` (`test/harness.ts:89-101`). Exactly one completion and one debit. The spec claims what it observes: one of the two did not land.
   - Expiry, in `packages/integration/clock/stamp-expiry.test.ts`, which moves the clock with `aztecDebug_warpL2TimeAtLeastTo`. It runs on a network of its own: `test:integration` becomes two `bun test` runs, `./test` and then `./clock`, each opening and tearing down its network through the shared preload, so no ordinary spec ever sees a warped clock and nothing rests on file order. The clock run refuses to start when `NET_L1_RPC` or `NET_NODE_URL` is set, before the preload opens the harness: those attach the suite to a network it does not own (`test/harness.ts:124`), and it must never move another run's clock. A warp lands on a slot boundary, not on the second asked for, so these cases read the actual anchor and inclusion timestamps and assert relations between them; exact-second boundaries are TXE's:
     - a tx that reads nothing commits `anchor + 82800`, asserted as a number, and so does a private payment through `payRequest`, including one whose request was opened in the last minute of a bucket and paid in the next;
     - once the stamp is no longer fresh, `payRequest` refuses a private payment as stale and still pays a public one; a direct private payment lands with `expiresAt == committedExpiry(tx, deadline(b))`. This equality is the cap's only proof by value;
     - near the deadline, with the merchant switched off meanwhile: a public payment by a user still lands (the search's full length, its gas recorded in the lessons file), and a private payment is proven and held;
     - at `deadline + 1`: the held tx is refused by the node; a fresh direct payment is refused privately (today's string with no capsule, "the request's stamp has expired" with the bucket capsule) and publicly.
2. `apps/showcase/src/live/actions.ts` and `packages/deployer/src/smoke.ts`: a stored request is replaced by a new one, in the same action, only when `payRequest` itself refuses it as `stale`. `stale` is only ever answered to the attempt that still owns the request's reservation (checked under the store's lock), so it proves nothing is in flight or paid for it; a request refused as in flight, uncertain or already paid is never replaced, because its first payment can still land for up to 23 h and a second request would be a second payment. Tests: a stale request is replaced and paid; a stale request whose first payment is still recorded as sent opens nothing and pays nothing.
3. Docs: every sentence `recon.md` lists as false; the refusals table; what integrations lose (the four behaviours); the rule that a contract completer authenticates its own callers and that "paid" means the first positive completion; the lifetime stated exactly (24 h to 25 h from the opening's anchor, under 25 h after a switch-off lands, the entry's delay plus 25 h from its scheduling, stamp-reliant payments only); `docs/assurance-map.md` (A21, A22); `AGENTS.md`; `implementations-plan/follow-ups.md` gains the testnet redeploy, without which production's live mode cannot use the testnet deployment.

**Validation gate (the arc's last).** Commands: `bash contracts/aztec/scripts/compile.sh --check`, `bun run test:noir`, `bash contracts/aztec/scripts/check-sole-consumer.sh`, `bun run lint && bun run typecheck && bun run test`, `bun run test:integration`, `bun run --cwd apps/showcase test:components`, `bun run test:e2e`. Pass: all exit 0. Layers: lint, typecheck, unit, TXE, integration on a local network (real kernels and PXE), browser e2e.

**Arc 2 quality loop:** as arc 1, then the final cross-arc pass.

## Architecture & Implementation

Arc 1 adds one module (`bridge-core/src/random.ts`) and one lock file; everything else edits existing files named in the phases. Alternatives not taken, by the owner's rule: re-running the pin check on every node reply, a second-node roster, pins in `verify`, renaming the portal's functions, a guardian cancel limit. Arc 2's architecture follows.

### Arc 2: expiring, pay-once stamps

Grounded in `recon.md` (reuse map and collisions). Outline A below is the plan; outline B is the competing approach both audits also saw. The decision ledger after it records what the audits changed.

#### The rule, in one place

- **Buckets.** Time is cut into 1 h buckets: `bucket(t) = t / 3600`. Opening a request for a proven merchant pushes `stamp(c, b)` with `b` the bucket of the opening tx's **anchor** timestamp, computed in the circuit. The pad is unchanged, so an opening still publishes exactly one nullifier.
- **Deadline.** `deadline(b) = (b + 25) * 3600 - 1`: the last second a payment that relies on that stamp may be included. It is a ceiling set by the contract, not a promise that a given wallet's tx stays valid until then (the PXE rounds each tx's own expiry down). Measured from the opening's anchor, the ceiling is at least 24 h and less than 25 h away (86 400 to 89 999 s); measured from the opening's inclusion, never more than 25 h. A stamp is **live** at `t` while `t <= deadline(b)`: the 25 buckets `bucket(t) - 24` to `bucket(t)`.
- **Private payment** (`transfer_private_to_commitment`). The hint returns the side and, for the stamp, its bucket. When the stamp is the side proven, the circuit pre-checks `stamp(c, b)` readably as today, asserts `anchor timestamp <= deadline(b)` ("Payment refused: the request's stamp has expired"), proves the stamp settled at the anchor, and calls `set_expiration_timestamp(deadline(b))`. The same constrained `b` feeds the hash and the deadline, so a hint cannot pair one stamp with another's deadline. The cap is what binds inclusion: without it a payer anchoring 24 h back would stretch the stamp by a tx's lifetime.
- **Public payment** (`transfer_public_to_commitment`). A merchant payer needs no stamp, checked first (two storage reads). Any other payer needs a stamp among the 25 buckets live at the block's timestamp, searched newest first; none found is today's refusal.
- **Pay once.** Both entry points push `paid(c)`, a third separated nullifier, after a readable pre-check ("Payment refused: the request is already paid"). The pre-check only words a sequential refusal; what makes a second payment impossible is the protocol's nullifier uniqueness, in the kernel and sequencer (private) and the AVM (public), across both paths. "Paid" means the first positive completion, in whatever amount the completer sent: a private payment of zero is refused ("Payment refused: the amount is zero"), public completion already refuses zero upstream, and the recipient checks the amount, as it must today.
- **Who can pay.** Unchanged: the account the opening named as completer, which is the caller of the payment, not necessarily the account debited. A contract named as completer must itself decide who may call it; one that lets anyone through lets anyone spend the request's single payment with one unit. Whoever knows a commitment's preimage can open it again (another completer, another hour's stamp); `paid(c)` is keyed on the commitment alone, so it is still paid once.
- **A merchant payer** is not bound by a stamp's expiry: it can pay any request by its own merchant proof, as today. Pay-once applies to every payer. `mint_to_commitment` is untouched: only the minter reaches it, into commitments whose completer is the minter.
- **Self-shield.** Unchanged in shape: a switched-off account paying its own stamped request from its public balance is a user payer, so it needs a live stamp and can do it once per request, within the deadline.

#### Why 1 h and 24 h

Every private call's kernel caps the tx at the called contract's update horizon, by default `anchor + 86399`: `anchor + DEFAULT_UPDATE_DELAY - 1` (`noir-protocol-circuits` `private-kernel-lib/src/components/private_kernel_circuit_output_composer/get_expiration_timestamp_for_contract_updates.nr:16-26`, `types/src/delayed_public_mutable/scheduled_delay_change.nr:128-178`, `scheduled_value_change.nr:64-83`, `types/src/constants.nr:1333`). The PXE returns the full 24 h only when the cap reaches `anchor + 86400`, and otherwise rounds the remaining lifetime down to whole hours, so an ordinary tx commits `anchor + 82800`; [A21] measures the same result. A call into a contract with its own shorter update delay, or a pending update, lowers that for its tx whatever the token does.

A payment through a stamp is unmarked exactly when `deadline(b) - anchor >= 82800`, which is `anchor < (b + 2) * 3600`: the stamp is then **fresh**. Every payment anchored less than 1 h after the opening's anchor qualifies, across an hour boundary too (the window is 3601 to 7200 s, depending on where in its bucket the opening fell). A lifetime under 24 h cannot give that; a bucket wider than 1 h only lengthens the tail (24 h buckets would mean up to 48 h); a narrower one shortens it by minutes and multiplies the candidates a search must try.

After that window a private payment through the stamp still works on chain until the deadline, and its expiry tells an observer how many whole hours the stamp had left. bridge-core refuses to send it (below). A payer who bypasses the SDK marks its own tx: the owner's rule.

#### Which proof a private payment makes

One order, in the token's hint and in bridge-core's `paymentSide` alike. Today's reason for "stamp first" (it caps no expiry) no longer holds for every stamp, so the order says when it does:

1. a fresh stamp: the stamp (no merchant entry read, standard expiry);
2. else a merchant payer: the payer (its entry's expiry, as any merchant transfer);
3. else a live stamp: the stamp, with a shortened expiry. bridge-core refuses here instead, as `stale`;
4. else nothing, and the payment is refused.

A side capsule still overrides the choice, as today; the constrained code proves whatever is named or refuses.

#### How the payer learns the bucket

The request stays a bare commitment: nothing new travels between clients.

- **bridge-core** finds it: `requestStamp(node, token, commitment)` sends the 25 live candidates, siloed, in one `findLeavesIndexes("latest", …)` call and returns the newest found as `{ bucket, unmarkedUntil, expiresAt } | undefined`. It replaces `isStamped`. For a stamp-side private payment `payRequest` hands the bucket to the circuit in a capsule at a second pinned slot (`STAMP_BUCKET_SLOT`), beside the side capsule.
- **The circuit's hint** takes the bucket from that capsule when present; otherwise it probes the live buckets at the anchor, newest first, through `check_nullifier_exists`, and only when the side capsule does not already name the payer (a merchant paying through bridge-core probes nothing). The bucket capsule is advice like the side capsule. It is also what lets a test hand the circuit a wrong bucket.
- **The public path** searches for itself, in the contract.

#### What each client sees

| Situation | bridge-core `payRequest` (before anything is sent) | A direct call |
|---|---|---|
| Fresh stamp, any payer | pays through the stamp; a private payment commits the standard expiry | same |
| Live stamp no longer fresh, user payer, private | `PaymentRefusedError("stale")`: "This request is too old to pay without marking the payment; ask for a new one." | lands until the deadline, with a shortened expiry |
| The same, public | pays (a public payment sets no cap, so nothing marks it) | same |
| Live stamp no longer fresh, merchant payer | pays by the merchant proof | same, by the hint's order |
| No live stamp (unstamped, or past its deadline), user payer | `TOKEN_REFUSALS.payment`, as today | the same string; "the request's stamp has expired" when a capsule names an expired stamp's bucket |
| No live stamp, merchant payer | pays by the merchant proof | same |
| Already paid | `completed-on-chain`, as today | "Payment refused: the request is already paid"; a tx racing the first is dropped as a repeated nullifier (private) or reverts (public) |

For a stamp-side private payment `payRequest` checks freshness twice. Before proving: `latest block timestamp < unmarkedUntil`, which only saves a wasted proof. Before the node receives the tx: the `PaymentGate`, which already sees every payment tx between proving and sending (`payments.ts:357-361`), refuses one whose committed expiry is under `anchor + 82800` and releases the reservation. The second check is the guarantee: however long the wallet took, no marked payment leaves the SDK. Both checks confirm, under the store's lock, that the attempt still owns the request's reservation before they answer `stale`: a reservation lapses after ten minutes, and an attempt superseded by another tab's payment must answer `in-flight` or `paid`, never `stale`, or a caller would replace a request whose payment can still land.

Refusal strings added to `TOKEN_REFUSALS`: `expired`, `alreadyPaid`, `zeroPayment`. No opening gains a cap: the bucket comes from the anchor, so a late inclusion only shortens the stamp's remaining life.

Integrations written against upstream keep every signature and lose four behaviours, listed in `docs/integration.md`: a second completion of one commitment, a private completion of zero, a user's payment into a commitment stamped more than a day ago, and a shared relay as completer without its own access rule.

#### File-level change map

- `contracts/aztec/merchant_stamp/src/lib.nr`: `STAMP_BUCKET`, `STAMP_LIVE_BUCKETS`, `stamp(commitment, bucket)`, `stamp_deadline(bucket)`, `paid(commitment)`, `DOM_SEP__MERCHANT_REQUEST_PAID`, `STAMP_BUCKET_SLOT`, and its header.
- `contracts/aztec/token/src/main.nr`: `_push_request_stamp` (bucket from the anchor), `_prove_payment_side` (bucket, deadline assert, cap, its doc), `transfer_private_to_commitment` (zero check, paid marker), `transfer_public_to_commitment` (merchant first, live-stamp search, paid marker), internal helpers only, and the comment at `:48-49`. No new external function, storage or event.
- `contracts/aztec/token/src/hints.nr`: `payment_side_hint` returns `(side, bucket)` by the order above; the bucket capsule; the live-stamp probe; the comments at `:58-59`. Every `bucket - i` is guarded against underflow, here and in the public search.
- `contracts/aztec/token/src/test/rules_requests.nr`, the hint tests, `txe-manifest.txt`, and the token and keystone floors in `contracts/aztec/scripts/run-txe-tests.sh`.
- `contracts/aztec/keystone/src/main.nr` and its manifest: the third separator derived, pinned and in the distinctness list; the bucket slot derived and pinned; vectors for `stamp(c, b)` and `paid(c)`.
- `contracts/aztec/token/target/merchant_token-Token.json` (through `compile.sh`), `packages/bridge-core/src/artifacts.test.ts` (class id).
- `packages/bridge-core/src/stamp.ts` (+ `stamp.test.ts`): the mirror and `bucketCapsule`. `merchants.ts` (+ test): `paymentSide` takes the stamp's state and follows the order. `payments.ts` (+ test): `requestStamp`, the `stale` refusal, the gate's expiry check, the header. `rules.ts`: three strings. `index.ts` exports.
- `apps/showcase/src/live/actions.ts` (+ test) and `packages/deployer/src/smoke.ts`: a stored request is replaced by a new one only on `payRequest`'s own `stale` refusal, never while its first payment may still land. `apps/showcase/e2e/fixtures/tour.json` stays as recorded: it replays a run, and nothing asserts its nullifier counts against a chain.
- `packages/integration/test/requests.test.ts`: [A22] rewritten for pay-once, with the contention case. A new `clock/stamp-expiry.test.ts`, which moves its network's clock (L1's too) with the node's `aztecDebug_warpL2TimeAtLeastTo` and so runs as a second `bun test` on a network of its own that it refuses to attach to (`packages/integration/package.json`; `tsconfig.json` includes `clock`); `harness.ts` gains the debug client; `committedExpiry` moves out of `transfers.test.ts` into a shared helper both specs import.
- `docs/architecture.md`, `docs/integration.md`, `docs/operations.md`, `docs/assurance-map.md`, `AGENTS.md` where a sentence becomes false; `implementations-plan/follow-ups.md` (the testnet redeploy).

#### Outline B (competing): carry the exact opening time with the request

The stamp binds the exact anchor timestamp; the opening hands it to the opener's client beside the commitment, the request travels as `(commitment, openedAt)`, and the payer supplies it by capsule. Exactly 24 h, no search, no bucket constant.

Not taken: the public path takes no hints and its signature is fixed, so a user could no longer pay a stamped request from a public balance (86 400 candidates per day cannot be searched), which changes a documented rule; a payer holding only the commitment could not pay at all; every client and the x402 request format would carry a second field. The tail it saves is under an hour. Both audits agreed, and found nothing in B worth taking.

#### Alternatives not taken

- An expiry in public storage keyed by the commitment: needs a public call at opening, which publishes the opening and breaks stamp/pad parity.
- Proving the stamp absent 24 h back (an exact tail, no buckets): public code has no historical reads.
- aztec-nr's `SingleUseClaim` for pay-once: keyed by owner and unusable in public.
- Enforcing either rule only in bridge-core: no on-chain bound, which is the finding.
- 24 h buckets (two candidates, no loop): up to 48 h.
- Probing one bucket past the live window so a just-expired stamp fails on its own message: the bucket capsule reaches the same assert, and tests it with a wrong bucket too.
- A distinct refusal for a stamp found expired by the public path or by an unaided probe: needs a search past the live window.
- A fixed margin between bridge-core's freshness check and the PXE's anchor: nothing bounds that gap; the gate's check on the proven tx does.

#### Decision ledger

Dual audit, 2026-10-02: Codex (default model, `medium`) returned `reject` with a stated path to approval; the Opus 5.5 `Plan` agent returned `approve with conditions`. Both chose outline A over B. On the revised plan the same Codex session found its three blockers resolved and returned `approve with conditions` (the two round 2 rows). A fresh Codex session, given the plan and this ledger, returned `approve with conditions` (the two fresh-pass rows). Every condition from all three is written into the plan. What each finding became:

| Finding | From | Decision |
|---|---|---|
| The 23 h baseline is not established; if it were 24 h the unmarked window would not span an hour boundary | Codex (blocker) | Settled from source: the kernel's contract-update horizon is `anchor + 86399` for every private call (the citation above; the Opus audit traced the same). Adopted its test ask: the baseline is asserted as a number, with a payment across an hour boundary |
| A 300 s margin does not bound the wallet's delay | Codex (blocker) | Adopted: the margin is gone; the `PaymentGate` checks the proven tx's committed expiry |
| The integration cases stop at the readable pre-checks | Codex (blocker), Opus | Adopted: a proven payment held past its expiry; a private and a public payment racing; a wrong bucket by capsule; the cap asserted by value; the paid marker asserted after each path alone |
| The merchant payer's side is contradictory, and "stamp first" lost its reason | Opus (blocker), Codex | Adopted: one four-step order for the hint and `paymentSide` |
| `stale` on public payments goes beyond the fixed input and shortens the self-shield through the SDK for nothing | Opus | Adopted: `stale` is for private stamp-side payments only |
| "Only that account can burn a request" is too strong: relay completers, re-opened commitments, dust | Codex, Opus | Adopted in wording and docs; no new token logic. Pay-once is "the first positive completion" |
| TXE runs the compiled artifact and checks no expiry | Opus | Adopted: compile before the TXE step; the plan says where the cap is proven (integration only) |
| `compile.sh --check` compares against `HEAD` | Codex | Adopted: the phase commits before its gate |
| The public search's cost is unmeasured | Codex | Adopted: its longest successful path runs in TXE and on a real network, gas recorded |
| The probe runs even when the side is already the payer | Opus | Adopted |
| The quality bar overstates: "about 24 h", "no payment", "fails on chain with a string" | Codex, Opus | Adopted: reworded under Outcome & Quality Bar |
| The expiry spec's ordering, its exact warps, one home for the parity case, a shared `committedExpiry` | Opus | Adopted |
| Replacing a stale request could double-pay while its first payment is still in flight | Codex (round 2) | Adopted: replacement only on `payRequest`'s own `stale` refusal, with a regression test |
| A filename is not evidence the clock-moving spec runs last | Codex (round 2) | Adopted: it runs as a second test run on a network of its own |
| A superseded attempt could be told `stale` and trigger a replacement | Codex (fresh pass) | Adopted: `stale` only to the reservation's current owner, with the supersession test extended |
| A second test run can still attach to a network it does not own | Codex (fresh pass) | Adopted: the clock run refuses the attach variables; `clock` joins the typecheck |
| `requestStamp` could also read `paid(c)` in its one call | Opus (note) | Not taken: `completionCount` already answers it and also covers a deployment of the old token |
| A bucket capsule is one more pinned slot | driver's first draft | Reversed: it is the only way to test a wrong bucket, and it spares bridge-core's payers the probe |

Unresolved between the reviewers: nothing. Their one difference (Codex wanted an expired stamp to "permit merchant fallback" and left the order open; Opus wrote the order) is settled by the order above, which satisfies both.

## Security & Adversarial Considerations

- **Arc 1** narrows trust; it adds none. The hash lock is wheels only, so no sdist build can pull an unpinned build dependency; wrangler's tree enters `bun.lock` under the 7-day gate. `--no-env-file` removes a file-borne input to every CLI run.
- **Arc 2** changes a rule in a token that cannot be upgraded: the two constants (1 h, 24 h) are fixed for the life of a deployment. The attacker is a switched-off merchant, a payer colluding with it, a stock-wallet payer who never loads the SDK, and an observer of the chain.
  - *A stamp stretched past its deadline.* Privately the cap on the tx's expiry bounds inclusion whatever anchor the payer picks; publicly the block's own timestamp is compared. A tx is includable while the block's timestamp is at most its expiration, so both paths end on the same second.
  - *An opener choosing its bucket.* The bucket is computed in the circuit from the anchor's timestamp; an anchor cannot be in the future, and an older one only shortens the stamp. An opening's inclusion is already capped by its merchant read (the entry's delay, or the second before a scheduled switch-off), so no stamp for an account is born after its switch-off lands, and none is payable more than 25 h after it.
  - *A hint or capsule naming the wrong bucket.* The one constrained bucket selects both the nullifier proven settled and the deadline asserted and capped: a wrong one is a stamp that does not exist or a deadline that has passed. The arithmetic is checked (`u64`), so an absurd bucket fails rather than wraps.
  - *A request spent by someone other than its payer.* Both paths complete only when the caller is the completer the opening named (upstream's validity commitment), so only that account can push the paid marker; a private payment of zero is refused. That is the account calling, not a person: a contract named as completer that lets anyone call it lets anyone spend the request with one unit, so such a relay must authenticate its callers, and the docs say so. The completer can pay less than asked, once: the recipient checks the amount, as it must today. A commitment re-opened by someone who knows its preimage is still paid once.
  - *A second payment that lands.* Both paths push the same `paid(c)`; nullifier uniqueness is the protocol's, across paths and within one block. The readable pre-check is not the control.
  - *Privacy.* An opening still publishes one nullifier, stamped or padded. A payment publishes one more nullifier than today, the same for every payment. Its expiry is the standard one while the stamp is fresh; after that it shows the whole hours a stamp had left, and the SDK refuses to send that, checking the proven tx itself. `stamp(c, b)` and `paid(c)` are hashes of the commitment: whoever holds the commitment can already watch its completion tag. The payer's node sees up to 25 stamp queries for one commitment where it saw one.
  - *Reorg and prune.* The stamp must be settled at the payer's anchor, as today; a pruned opening takes its stamp with it and a pruned payment its paid marker. Nothing is reported final before it is.
  - *Diverging derivations.* The separator and both hashes are derived in Noir, pinned in the keystone with vectors, and mirrored in TypeScript against the same vectors.
  - *Denial of service.* The public search is bounded at 25 hashes and existence checks and runs only for a payer that is not a merchant; its longest path is run on a real network and its gas recorded.
  - *Supply chain, credentials, cryptography.* No new dependency, credential or primitive: Poseidon2 through aztec-nr, as the stamp uses today.
- **Never in this plan:** keyed runs, testnet commands, new secrets, a merge.

## Assumptions

- **Facts:** the fixes of Phase 1 pass `bun run lint`, `typecheck`, the bridge-core and deployer unit suites and `lint:actions` on `9f84cdb` (run 2026-10-02); the hash-locked halmos passes the strict gate on Python 3.12; the kernel takes `min(contract cap, wallet upper bound, anchor + MAX_TX_LIFETIME)` (`noir-protocol-circuits` `private-kernel-lib/src/components/tail_output_validator.nr:60-83`, `types/src/constants.nr:202`); a user's payment proves the stamp alone (`contracts/aztec/token/src/main.nr:1094-1120`, `:408-415`); completion is not single-use upstream (`aztec-nr` `uint-note/src/uint_note.nr:183-188`).
- **Inferences:** the changed CI install step works on a GitHub runner (venv and pip from the runner's Python 3.12; first proven by the PR's own `contracts` run); a recipient can recover later completions with custom discovery (read, never run; pay-once makes it moot).
- **Asks:** none open.

Arc 2:

- **Facts:**
  - The PXE returns `anchor + MAX_TX_LIFETIME` only when the in-circuit cap reaches it, and otherwise rounds the remaining lifetime down to whole hours, half hours, then seconds (`@aztec-labs/pxe` `dest/private_kernel/hints/compute_tx_expiration_timestamp.js`). [A21] (`packages/integration/test/transfers.test.ts:59-78`) measures a transfer reading a 24 h entry (cap `anchor + 86399`) against a tx that reads nothing and finds their lifetimes equal; it passed on 2026-10-02 in Phase 2's gate.
  - `set_expiration_timestamp` keeps the minimum (aztec-nr `aztec/src/context/private_context.nr:648-651`); a tx is rejected only when `expirationTimestamp < block timestamp` (`@aztec-labs/p2p` `dest/msg_validators/tx_validator/timestamp_validator.js:15`).
  - Private completion proves the validity commitment of `(commitment, completer)` settled and does not refuse zero; public completion refuses zero (aztec-nr `uint-note/src/uint_note.nr:189-243`).
  - The side hint already runs unconstrained oracle probes and the token already pre-checks a nullifier before the kernel's existence request (`contracts/aztec/token/src/hints.nr:60-74`, `main.nr:1105-1115`).
  - `abi-superset.test.ts` lists external functions, storage and events only (`contracts/aztec/scripts/abi-superset.test.ts:12-30`); this design adds none and changes no signature.
  - The pinned node exposes `warpL2TimeAtLeastBy` on its debug API, served by the automine sequencer (`@aztec-labs/stdlib` `dest/interfaces/aztec-node-debug`; `@aztec-labs/aztec` `dest/local-network/local-network.js:94`).
  - `instanceFromRecord` refuses an artifact that does not derive a manifest's instance (`packages/bridge-core/src/instances.ts:35`), and no CI step compares the committed artifact with `deployments/testnet.json` (`apps/showcase/build/manifest-identity.test.ts`).
  - Every private call's kernel caps its tx at the called contract's update horizon, `anchor + 86399` by default (the citation under "Why 1 h and 24 h"), which the PXE rounds to 23 h; a payment into this token carries the same cap.
  - TXE deploys the token from its compiled artifact and checks no tx's expiry (`@aztec-labs/txe` `src/utils/txe_artifact_resolver.ts:125-136`, `src/oracle/txe_oracle_top_level_context.ts:575-700`), so only the integration spec observes the cap.
  - The debug namespace is registered under `--local-network` (`@aztec-labs/aztec` `dest/cli/aztec_start_action.js:31-33`), which is how this repo starts its node (`packages/local-network/src/network.ts:131`). Run on a throwaway local network on 2026-10-02: `aztecDebug_warpL2TimeAtLeastBy` answers on the node's own URL, and warps of 26 h and then 1 h each built the next block.
  - An opening's merchant read caps its inclusion at the second before a scheduled switch-off (`contracts/aztec/token/src/main.nr:1051-1062`), so no stamp for an account is born after its switch-off lands.
  - The kernel takes the minimum of every call's cap, so a payer cannot raise the stamp's (`private-kernel-lib/src/components/private_kernel_circuit_output_validator.nr:73-89`, `tail_output_validator.nr:60-83`).
  - The committed token's public bytecode packs to about 1206 of the 2700 fields the ceiling allows.
  - A commitment is not unique to one opening: its randomness is the prover's (aztec-nr `uint-note/src/uint_note.nr:110`). The design keys `paid(c)` on the commitment and takes the newest live stamp.
- **Inferences:**
  - TXE refuses a repeated nullifier pushed in private. If it does not, the pre-check still fails the test; the contention spec is what shows the protocol's refusal.
  - After a 25 h warp, which moves L1's clock too, the spec's own network still serves its txs (a bare network built blocks after one; a deployed bridge with funded actors was not tried). If it does not, the spec's later cases each start from a fresh network, at the cost of minutes.
  - A wallet can prove a tx and hold it, as `sendTogether` already does for the harness's actor wallet.
  - Up to 25 sequential existence probes are tolerable for a stock wallet with no capsule that pays as a user.
- **Asks:** none open. One consequence the owner acts on at merge, not before: this arc changes the token's class, so the code on `main` after the merge, and so production's live mode, cannot use the testnet deployment until it is redeployed (a keyed run, never the agent's). The PR body and `implementations-plan/follow-ups.md` say so.

## Delivery

| Arc | Phases | Stacks on | `/code-review` |
|---|---|---|---|
| `harden-fixes` | 1, 2 | `main` | off |
| `expiring-stamps` | 3 onward | `harden-fixes` | off |
| `harden-security-whole-repo-close-out` (docs only) | close-out | `expiring-stamps` | off |

`gh stack init --adopt worktree-harden-security-whole-repo`; `gh stack add harden-expiring-stamps` only after arc 1's loop converges. No PR, draft or not, before every loop has converged.

## Post-implementation

1. **Codex audit, per arc at its boundary** (`/codex medium`): the arc's diff, this plan, the arc map ("arc N of 2; arc 2 builds expiring stamps on it"), the adversarial ask ("What could go wrong? What would an attacker target? What are we trusting that we shouldn't?"), and both rules below, verbatim.
   - *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
2. **Fix loop:** verify each claim against the repo, apply what is accepted, commit, log the round in `lessons/phase-N.md`, resume the same Codex session with the fix diff. Repeat until a round yields nothing material. Still material after 3 rounds: stop and report to the owner.
3. **Cross-arc pass:** after both arcs, a fresh Codex session over the net diff from `9f84cdb`, asking for seams between the arcs, duplication and drift from this plan; same loop.
4. **Delivery:** `gh stack sync` if `main` moved, `gh stack submit --auto`, then `gh pr edit` each body. Then `gh stack add harden-security-whole-repo-close-out`, the close-out commits, `gh stack submit --auto`, `gh pr checks --watch`.
5. **Close-out:** an `## Outcome` block directly after this front matter (date, status, PR numbers, what was dropped and why, a line retiring the seeds); promote generalizable gotchas into `implementations-plan/lessons.md` within its 8 KiB budget; move open follow-ups into `implementations-plan/follow-ups.md` (the owner's Cloudflare dashboard command switch, the testnet redeploy with the new token, anything deferred); `git mv` this folder into `implementations-plan/archive/` in its own commit and repair links; move the index line to `archive/index.md`.
6. **The audit's reports:** mark every finding fixed (with its PR) or accepted in `audit/security/2026-10-02-whole-repo/raw/_report-head.md`, rebuild `report.md` with `raw/_assemble-report.sh`, update the decisions table in `report.html` and republish it to the same Artifact. These files are git-excluded: they are updated in place, not committed.
7. Report and stop. Merging is the owner's call.

Before any install, build or test: confirm no keyed run is live on the host.

## Seeds

Stakeholder report (Artifact): https://claude.ai/artifact/LXgU8PAxc5bouPZ4rpKw7y · source `audit/security/2026-10-02-whole-repo/report.html`.

Arc 2 in plain language (Artifact): https://claude.ai/artifact/LZCKRBcrKFeMGaQakaxe51 · source `implementations-plan/harden-security-whole-repo/eli5.html` (written locally, never committed).

```
/goal Every phase header in implementations-plan/harden-security-whole-repo/plan.md is marked ✓ in the file, each backed by its validation gate reported passing in the transcript and a printed `LESSONS_FILE=implementations-plan/harden-security-whole-repo/lessons/phase-N.md`; the stamp change was planned with /blueprint mid inside that file and implemented only after Codex and the Opus 5.5 audit both returned an explicit approve, quoted in the transcript; /code-review was not run; the Codex fix loop converged for each arc and for the cross-arc pass, each shown by a resumed Codex pass reporting no new material findings; the stacked PRs and the docs-only close-out exist on GitHub, opened only after the loops converged (`gh stack view` output in the transcript) with checks green; `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:noir`, `bash contracts/aztec/scripts/compile.sh --check` and `bun run test:integration` report exit 0 in the transcript; the audit's report.md and its Artifact list every finding as fixed with its PR or accepted. Follow plan.md's owner decisions and Post-implementation section exactly; never merge, never run a keyed or testnet command, never change an accepted finding; if a reviewer rejects the stamp plan, a disagreement stays unsettled, or a fix loop still finds material issues after 3 rounds, stop and report instead.
```
