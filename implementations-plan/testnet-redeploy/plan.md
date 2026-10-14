---
plan: testnet-redeploy
tier: light
driver: claude-code
eli5_mode: skipped (director's brief)
code_review: off
codex_model: sol
explainer: off
trunk: dev
issue: 49
---

# Redeploy the testnet bridge on Aztec 6.0.0-rc.3

`dev` runs Aztec 6.0.0-rc.3 (#91), but `deployments/testnet.json` names a bridge on the retired rc.1 rollup. This batch deploys the bridge on the rc.3 rollup with the runbook (`docs/operations.md`, "Testnet, in order"), hands the admin roles to the owner's admin, sets up the demo cast, records the tour, and ships the three files in one PR to `dev` (`Closes #49`). No code changes.

## Outcome & Quality Bar

- **For whom**: a visitor of the `dev` preview, and a reader who verifies the testnet deployment from its manifest.
- **Excellent**: `bridge verify deployments/testnet.json --tour deployments/testnet-tour.json` passes strict, with `ok` for both creation-tx checks and `merchant delay setting == manifest` (#49); `test:testnet` against the `dev` preview passes live, proving in the browser.
- **Good enough**: lessons record every tx hash and address the runbook prints; no extra checks beyond the runbook's.

## Architecture & Implementation

- **Change map**: `deployments/testnet-deploy.env.example` (the rc.3 admin address), `deployments/testnet.json`, `deployments/testnet-demo.json` (version 2), `deployments/testnet-tour.json`, this plan folder. No code.
- **Keyed cycle** (each keyed run): commit and push the branch → `bash scripts/keyed-worktree.sh sync` → file the request from `~/.cache/inference-money/keyed` with the runbook template, the chain ending in `secrets:scan` → `KEYED <n>` to the director → `env-exec wait <id>`. After a run that writes files: copy them into this worktree, check them byte-identical, commit, push, then `keyed-worktree.sh remove` and `sync` (sync refuses a keyed tree with local changes, and env-exec refuses a dirty tree).
- **Keyless steps** (`demo setup`, `demo status`, `verify`, `smoke --record`) run in this worktree, so their outputs land on the branch directly; their state lives in `~/.cache/inference-money/{demo,smoke}/<bridge>/`, shared by both checkouts.
- **Alternative not taken**: the keyless steps in the keyed worktree, as the brief's step 7 says. Rejected: each output there dirties the keyed tree before the next request.

## Security & Adversarial Considerations

- **Secrets**: the L1 key, deployer secret and admin secret reach only env-exec children; the CLI redacts and scrubs them; every chain ends in the scan. No agent reads, prints or guesses one. No `bridge disposable`.
- **Host**: while a keyed run is live, nothing is installed, built, tested or committed on the host. Before each request, check that no keyed run is running (`env-exec status`; pending is fine) and say so in the `KEYED` message.
- **Code the keys run**: env-exec pins the keyed tree's commit, a pushed branch tip; the keyed install skips scripts.
- **Wrong admin**: a deploy proposes both roles to `TESTNET_ADMIN_ADDRESS`; an address no key controls strands the handover (Fact 1). KEYED 0 derives it on rc.3 first.
- **Public data**: addresses, tx hashes and demo keys only. The only RPC URLs written are the committed defaults (`networks.ts`).
- **Chain risks**: a rollup switch mid-run (probe first; the deploy probes again); front-running a cast binding (the merchants' salt stays unpublished until setup ends, #94); a reorg before finality (`demo setup` and `smoke` wait for finalized claims).

## Assumptions

**Facts**
1. The rc.3 bump moved the Schnorr address of a fixed secret: `packages/demo/src/cast.test.ts:15` changed `0x0c5460e0…` → `0x19587f1d…` in 0d4460e; `admin address` derives with `getSchnorrAccountContractAddress` (`packages/demo/src/cast.ts:56`). So the committed `TESTNET_ADMIN_ADDRESS` (`0x094fe37a…`, equal to the old manifest's `l2.admin`) is the rc.1 derivation. Director's ruling: KEYED 0 = `admin address`, then commit the result.
2. `probe:testnet`: 19/19 on 2026-10-14 (node 6.0.0-rc.3, rollup 3409706519, SponsoredFPC published, faucet 1000 FJ per mint ≥ 76.64 budget).
3. The cast's Ethereum keys derive from the bridge address (`packages/demo/src/keys.ts`), so the new cast starts empty and `demo fund` sends 50.02 USDC and 0.04 ETH (`amounts.ts:17`); the sponsor top-up is a Fee Juice mint, not USDC (`demo.ts:298`).
4. The L1 deploy key `0xFcc2…F6F5` held 40.657366 USDC. With the director's yes, the retired rc.1 cast moved its USDC there (public demo keys): A_demo 12.71 (`0xc826953c…a2a2`), B_demo 9.20 (`0xea5470d4…c4c7`). Now 62.567366 USDC, 4.2571 ETH.
5. `secrets:scan` failed `skipped=3` on a closed audit's Python venv; with the director's yes, `~/.cache/inference-money/audit-tools` moved to `~/.cache/inference-money-audit-tools`. Now `found=false files=4008 skipped=0 walletDirs=0`.
6. `deployTestnet` writes the manifest only after the handover is proposed and verify passes (`testnet.ts:113-119`), and records `portalTx`, `routerTx`, `merchantDelay` (`deploy.ts:80-88`).
7. No `verify:testnet` script exists; the gate is `bun run bridge verify deployments/testnet.json`.

**Inferences**
- I1. The 1Password items `InferenceMoney-Testnet` and `InferenceMoney-Testnet-Admin` exist from the last redeploy, so `op-remote <host> <id>` approves without `op-remote create`.
- I2. The deployer secret's L2 account also moves under rc.3; the deploy deploys it with self-funded fees, as on any fresh rollup.

**Asks** (director's, before KEYED 1)
- A1. rc3-bump's A2: does Galactica's deployed x402 integration rely on the rc.1 owner of `transfer_private_to_public_with_commitment`? It gates this redeploy, not its merge.

## Phases

### Phase 1: KEYED 0, the rc.3 admin address
1. File `admin address` under `deployments/testnet-admin.env.example`. Send KEYED 0. Wait.
2. Put the printed address into `TESTNET_ADMIN_ADDRESS`. Commit `chore(deploy): the admin address on rc.3`, with this plan. Push. Sync.

**Validation gate**: the run exits 0 with a scan line `found=false … skipped=0 walletDirs=0`; the address is a 32-byte hex value and differs from `0x094fe37a…`; `bun run lint` exits 0.

### Phase 2: KEYED 1, probe, deploy and fund
1. Re-read the deploy key's ETH and USDC; quote them in KEYED 1 (USDC ≥ 50.02).
2. File `bun run bridge probe testnet && bun run bridge deploy testnet && bun run bridge demo fund deployments/testnet.json` under `deployments/testnet-deploy.env.example`. Send KEYED 1. Wait.
3. Copy `deployments/testnet.json` out, commit, push, remove and sync the keyed worktree.

**Validation gate**: exit 0; the log shows "verified with the handover pending" and the funding lines; scan clean; the manifest's `l2.nodeVersion` is `6.0.0-rc.3`, `rollupVersion` 3409706519, and it carries `portalTx`, `routerTx`, `merchantDelay`. A `demo fund` failure after a passing deploy reruns `demo fund` alone under `testnet-fund.env.example`.

### Phase 3: KEYED 2, admin accept; demo setup to the listing
1. File `bun run bridge admin accept deployments/testnet.json` under the admin template. Send KEYED 2. Wait. Copy, commit, push, remove, sync.
2. Keyless: `bun run bridge demo setup deployments/testnet.json`. It stops at the listing.

**Validation gate**: the accept exits 0 with a clean scan, and `l2.admin` equals Phase 1's address; `demo setup` stops on the listing message and prints both merchant addresses.

### Phase 4: KEYED 3, list the merchants; finish the demo
1. File `bun run bridge merchants add deployments/testnet.json <galactica> <supplier>` under the admin template. Send KEYED 3. Wait.
2. Keyless: `demo setup` again, then `bridge verify deployments/testnet.json`, then `bridge smoke deployments/testnet.json --record deployments/testnet-tour.json`. Keep the smoke alive through its epoch-proof wait (up to 3 h); rerun it if it stops.

**Validation gate**: `deployments/testnet-demo.json` has `version: 2`, the bridge and a merchants' salt; `verify` exits 0 with `ok` for both creation-tx checks and the delay setting, and lists exactly galactica and supplier; `smoke` exits 0.

### Phase 5: ship
1. `bun run lint && bun run typecheck && bun run test`; `bun run --cwd apps/showcase build:testnet`; `bun run bridge verify deployments/testnet.json --tour deployments/testnet-tour.json`.
2. Commit `chore(deploy): redeploy testnet on Aztec 6.0.0-rc.3 and record the tour`. Push. Open the PR. `bash scripts/keyed-worktree.sh remove`.
3. After the owner merges and the `dev` preview builds: `SHOWCASE_URL=https://dev-inference-money.alejo-amiras.workers.dev bun run --cwd apps/showcase test:testnet`; quote it in a PR comment.

**Validation gate**: each command exits 0; `build:testnet` passes its 7 bundle checks; PR CI green; the served check passes.

## Plan audit

Pending.

## Approval

Pending.

## Delivery

Single arc: branch `worktree-testnet-redeploy`, one PR to `dev` (`gh pr create --base dev`), body with `Closes #49`, the rc.3 admin-address fact, a "Demo float" section (Fact 4), every tx hash and address, and the gates. The close-out lands as the PR's final commits. No lanes: every phase waits on the previous one.

## Post-implementation

While implementing: log every keyed run, tx hash and address in `lessons/phase-N.md`; stop after 3 failures on one step; update `agent-worktree status testnet-redeploy "<phase>"` and the crew status file at each gate.

1. **Codex fix loop**: none, since no code changes. If code does change, run `/codex high` on `gpt-6.1-sol` over the diff with the adversarial ask and the blueprint's no-over-engineering and comment-quality rules verbatim; hard stop after 3 rounds.
2. **Delivery**: `gh pr create --base dev`, then `gh pr checks --watch`.
3. **Close-out**, as the PR's final commits: an `## Outcome` block after the front matter (date, status, PR, dispositions, `Known limits:`, `Open items:`, one line retiring the seeds); promote general lessons into `implementations-plan/lessons.md` (8 KiB budget, dedupe, retire); file open items (issue, `owner-decision`/`blocked:external` issue, private advisory, or closed `known-limit` issue); `git mv implementations-plan/testnet-redeploy implementations-plan/archive/testnet-redeploy` in its own commit, links repaired; index line to `archive/index.md`.
4. **Report** `DONE testnet-redeploy: <PR url>; CI <state>`. Merging is the owner's call.
5. **Teardown after the merge**: once `git fetch -q origin dev && git cat-file -e FETCH_HEAD:implementations-plan/archive/testnet-redeploy/plan.md` succeeds, run the served check (Phase 5.3), then `ExitWorktree` (`keep`), then `agent-worktree done testnet-redeploy --merged --trunk dev`; never force past a refusal.

## Seeds

None: this session executes the plan under the director's protocol.
