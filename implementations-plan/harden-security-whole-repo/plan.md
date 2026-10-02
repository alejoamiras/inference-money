---
plan: harden-security-whole-repo
driver: claude-code
eli5_mode: artifact
code_review: off
claude_model: opus
codex: default model, medium effort
baseline: 9f84cdb
---

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
  1. After a switch-off lands, no payment into any request stamped for that account can be included more than about 24 h later, and a test proves the boundary on a real network, not only in TXE.
  2. A payment made within 1 h of its request's opening commits the same expiry as a transaction that reads nothing; the existing parity test (`packages/integration/test/transfers.test.ts`, A21) gains that case.
  3. A second payment into one request fails on chain with a refusal string exported from `rules.ts`, through both the private and the public path.
  4. Every operator-facing message and doc sentence touched says what the command did or what a pass proves, with no claim wider than the code.
- **Good enough:** no new configuration surface, no defence the owner declined, no change to accepted findings, upstream signatures untouched.

## Phases

### Arc 1: `harden-fixes` (branch `worktree-harden-security-whole-repo`)

#### Phase 1: the fixes already in the working tree

C-001 (`packages/deployer/src/deploy.ts`, `testnet.ts`), C-002 (`packages/bridge-core/src/random.ts`, `deposit.ts`, `packages/deployer/src/disposable.ts`, `cli.ts`, two tests), C-004 (`admin.ts`, `commands.ts`), C-015 (`verify-cli.ts`), C-013 guardian check (`verify.ts`, `verify-cli.ts`, `cli-args.ts`, `commands.ts`, `packages/integration/test/operator.test.ts`), C-006 and C-016 (`.github/workflows/`), C-009 (`.github/actions/setup-toolchains/`, `apps/showcase/package.json`, `bun.lock`), docs for C-005, C-012, C-014, C-017 (`docs/`, `packages/deployer/src/export.ts`, `packages/bridge-core/src/payments.ts`). Review the diff once as a whole, then commit it in focused conventional commits.

**Validation gate.** Commands: `bun run lint && bun run typecheck && bun run test && bun run lint:actions && bun run test:evm:formal`. Pass: all exit 0; the halmos gate prints "exactly the 11 expected proofs passed". Layers: lint, typecheck, unit, formal.

#### Phase 2: `--no-env-file` and the three routed bugs

- `--no-env-file` on the operator CLI's scripts (`package.json`: `bridge`, `secrets:scan`, and any script that runs `packages/deployer/src/cli.ts`); the keyed-run and disposable re-exec paths (`packages/deployer/src/redact.ts`, `disposable.ts`) must pass it too, or a child loads the file its parent refused. A test proves a `.env` in the working directory no longer reaches the CLI.
- Teardown under a changed time zone: `packages/local-network/src/process.ts:20-23`, `:67-68`, `network.ts:198` compare `ps lstart` text. Compare a time-zone-independent start time; unprovable still means untouched.
- A reverted exit reported final too early: `packages/bridge-core/src/exit.ts:173-179`, `return.ts:98`. Report a revert as final only on finalized evidence, as payments already do (`finalFate`); check the showcase's use of the result.
- The second anvil on port 8545 from the pinned launcher: confirm by running a local network. Fix in the repo if a supported option exists; otherwise document it in `docs/` and add it to `implementations-plan/follow-ups.md`. Do not patch the pinned dependency.

**Validation gate.** Commands: the Phase 1 gate, then `bun run test:integration`. Pass: all exit 0. Layers: lint, typecheck, unit, formal, integration on a local network.

**Arc 1 quality loop:** the Codex fix loop of the Post-implementation section, over the arc's diff, before `gh stack add`.

### Arc 2: `expiring-stamps` (branch `harden-expiring-stamps`, stacked on arc 1)

#### Phase 3: the plan (`/blueprint mid`, inside this file)

Run the blueprint's recon, draft with a competing outline, dual audit (Codex and an Opus 5.5 `Plan` agent), decision ledger and a fresh Codex pass, and write its Architecture & Implementation, Security, Assumptions and its implementation phases (Phase 4 onward, each with a gate) into this file. Publish the plain-language summary as an Artifact and record its URL here. Evidence to start from: the audit's `report.md` (C-017) and `findings/verify/S-001-{claude,codex}.md`.

Fixed inputs, not open for redesign:
- Lifetime 24 h; pay once; self-shield unchanged; upstream signatures unchanged (`contracts/aztec/scripts/abi-superset.test.ts`).
- A payment anchored within 1 h of its request's opening anchor must commit the standard expiry (`anchor + 82800`): the PXE rounds an in-circuit cap down from the anchor to whole hours (`@aztec-labs/pxe` `src/private_kernel/hints/compute_tx_expiration_timestamp.ts`). So a stamp needs at least 24 h left when opened, whatever the bucket size; state the resulting worst-case tail exactly (it may be 25 h, not 24).
- bridge-core's `payRequest` refuses a request too old to pay unmarked, before anything is proven.
- Pay-once: both payment entry points emit the same commitment-derived nullifier; a zero-amount private payment must not be able to burn a request.

Questions the plan must answer: how the payer learns the stamp's time bucket (carried with the request, or probed); whether opening needs any new expiry cap; what an expired or already-paid request looks like to each client; which refusal strings are added.

**Validation gate.** Pass: Codex's fresh-context verdict and the Opus audit's verdict are both an explicit `approve` (a conditional approve counts once its conditions are written into the plan), quoted in the transcript; every implementation phase added carries a gate from this repo's real commands.

#### Phase 4 onward: implementation

Defined by Phase 3. The arc's last gate must include: `bash contracts/aztec/scripts/compile.sh --check`, `bun run test:noir`, `bash contracts/aztec/scripts/check-sole-consumer.sh`, `bun run lint && bun run typecheck && bun run test`, `bun run test:integration`, `bun run --cwd apps/showcase test:components`, `bun run test:e2e`.

**Arc 2 quality loop:** as arc 1, then the final cross-arc pass.

## Architecture & Implementation

Arc 1 adds one module (`bridge-core/src/random.ts`) and one lock file; everything else edits existing files named in the phases. Alternatives not taken, by the owner's rule: re-running the pin check on every node reply, a second-node roster, pins in `verify`, renaming the portal's functions, a guardian cancel limit. Arc 2's architecture is written by Phase 3.

## Security & Adversarial Considerations

- **Arc 1** narrows trust; it adds none. The hash lock is wheels only, so no sdist build can pull an unpinned build dependency; wrangler's tree enters `bun.lock` under the 7-day gate. `--no-env-file` removes a file-borne input to every CLI run.
- **Arc 2** changes a rule in a token that cannot be upgraded. Threats to design against: a payment marked by its expiry (privacy); a stamp accepted past its lifetime through a stale anchor or the public path; a request burned by someone other than its payer; a second payment that still lands; an opener choosing a later bucket than its anchor's; divergence between the Noir, Solidity-free TypeScript and keystone derivations of the new nullifiers. Reorg and prune: nothing may be reported final before it is.
- **Never in this plan:** keyed runs, testnet commands, new secrets, a merge.

## Assumptions

- **Facts:** the fixes of Phase 1 pass `bun run lint`, `typecheck`, the bridge-core and deployer unit suites and `lint:actions` on `9f84cdb` (run 2026-10-02); the hash-locked halmos passes the strict gate on Python 3.12; the kernel takes `min(contract cap, wallet upper bound, anchor + MAX_TX_LIFETIME)` (`noir-protocol-circuits` `private-kernel-lib/src/components/tail_output_validator.nr:60-83`, `types/src/constants.nr:202`); a user's payment proves the stamp alone (`contracts/aztec/token/src/main.nr:1094-1120`, `:408-415`); completion is not single-use upstream (`aztec-nr` `uint-note/src/uint_note.nr:183-188`).
- **Inferences:** the changed CI install step works on a GitHub runner (venv and pip from the runner's Python 3.12; first proven by the PR's own `contracts` run); a recipient can recover later completions with custom discovery (read, never run; pay-once makes it moot).
- **Asks:** none open.

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

```
/goal Every phase header in implementations-plan/harden-security-whole-repo/plan.md is marked ✓ in the file, each backed by its validation gate reported passing in the transcript and a printed `LESSONS_FILE=implementations-plan/harden-security-whole-repo/lessons/phase-N.md`; the stamp change was planned with /blueprint mid inside that file and implemented only after Codex and the Opus 5.5 audit both returned an explicit approve, quoted in the transcript; /code-review was not run; the Codex fix loop converged for each arc and for the cross-arc pass, each shown by a resumed Codex pass reporting no new material findings; the stacked PRs and the docs-only close-out exist on GitHub, opened only after the loops converged (`gh stack view` output in the transcript) with checks green; `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:noir`, `bash contracts/aztec/scripts/compile.sh --check` and `bun run test:integration` report exit 0 in the transcript; the audit's report.md and its Artifact list every finding as fixed with its PR or accepted. Follow plan.md's owner decisions and Post-implementation section exactly; never merge, never run a keyed or testnet command, never change an accepted finding; if a reviewer rejects the stamp plan, a disagreement stays unsettled, or a fix loop still finds material issues after 3 rounds, stop and report instead.
```
