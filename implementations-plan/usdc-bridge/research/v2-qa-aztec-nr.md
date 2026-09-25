> Raw read-only explorer report (sonnet), 2026-09-25: nulo V2 `6611f861` vs V1 `4df5eae5`. Verdicts are filtered and corrected in `../plan.md` § V2 QA port, which wins on any conflict.
> Known corrections: "TXE stays local-only, never runs in `_bridge-contracts.yml`" is **false** at `6611f861` — the workflow has a `txe` job running `run-txe-tests.sh --crate token_bridge_hub` (the brief's "out of scope" line predates it; codex r4). Class-id parity alone does not cover public ABI entries (codex r4 M1).

Search trail: nulo repo at ~/Projects/nulo, branch main. V1 = `4df5eae5` (2026-09-02), V2 freeze = `6611f861` (2026-09-24). V2's Aztec hub landed in `0f03e554` "feat(bridge): token hub on L2 … TXE suite (#537)" (2026-09-04, Arc 2 of `implementations-plan/any-erc20-bridge/`, stacked PR #541). Read via `git show <sha>:<path>`, `git ls-tree -r --name-only <sha> -- <dir>`, `git diff 4df5eae5 6611f861 -- <path>`. Every file under `contracts/bridge/aztec/` was read in full at both commits; `implementations-plan/any-erc20-bridge/{brief,lessons/phase-{1,3,4},audit-codex-final,audit-fable}.md`, `.github/workflows/_bridge-contracts.yml` at both commits, and `packages/bridge-core/{src/noir-artifact-classids.test.ts,scripts/noir-class-id.ts}` at both commits were read for cross-cutting mechanisms.

Key fact confirmed up front: **V1's 33 TXE tests split exactly as `implementations-plan/any-erc20-bridge/audit-fable.md:41` states — 12 are proxy/ownership-only (they vanish because the hub has no proxy and is ownerless) and 21 are claims/claims_private/exits, which the hub's 65 tests are a superset-with-two-tokens expansion of.** No V2 test, translated to V1's actual contracts, exposes a behavior V1's code fails to enforce — see §7's bug-flag conclusion up front since it's the critical ask.

---

## 1. Per-V2-test verdicts (65 tests across `token_bridge_hub/src/test/*.nr`)

Legend: verdict = PORT-AS-IS / ADAPT / DROP. V1-equiv = existing V1 test name, or "GAP" (property applies to V1's code but V1 has no test for it), or "N/A" (hub/registration-only, doesn't apply).

### claims.nr (10 tests) — concept: claims public

| Test | Property | Verdict | V1 equivalent | Effort |
|---|---|---|---|---|
| `claim_public_mints_the_registered_token` | happy path mints to recipient | PORT-AS-IS | `claim_public_mints_to_recipient` | S |
| `claim_public_message_from_portal_a_cannot_mint_token_b` | portal-A message can't mint token B | DROP (two-token, hub-only) | N/A | — |
| `claim_public_two_tokens_credit_independently` | two tokens credit independently | DROP (hub-only) | N/A | — |
| `claim_public_unregistered_token_reverts` | unregistered token dies on uninitialized `PublicImmutable` | DROP (registration concept doesn't exist in V1 — V1's bridge is wired once at deploy, "unregistered" has no meaning) | N/A | — |
| `claim_public_zero_amount_rejected` | amount=0 rejected pre-message-read | PORT-AS-IS | `claim_public_zero_amount_rejected` | S |
| `claim_public_wrong_secret_rejected` | wrong secret unconsumable | PORT-AS-IS | `claim_public_wrong_secret_rejected` | S |
| `claim_public_wrong_recipient_rejected` | recipient inside content hash, can't redirect | PORT-AS-IS | `claim_public_wrong_recipient_rejected` | S |
| `claim_public_wrong_amount_rejected` | amount inside content hash | **ADAPT — V1 GAP**: no V1 test asserts a wrong-amount claim fails (code enforces it via content-hash membership, same mechanism as wrong-secret/recipient, but it's never separately pinned) | GAP | S |
| `claim_public_replay_rejected` | nullifier replay | PORT-AS-IS | `claim_public_double_claim_rejected` | S |
| `claim_public_by_relayer_credits_the_recipient` | anyone may submit; funds land with committed recipient, not caller | **ADAPT — V1 GAP**: V1's only public-claim test has caller==recipient (`to` calls for itself); a relayer-submits-public-claim path is never exercised (private relayer path IS tested: see below) | GAP | S |

### claims_private.nr (10 tests) — concept: claims private (F-007 recipient commitment)

| Test | Property | Verdict | V1 equivalent | Effort |
|---|---|---|---|---|
| `claim_private_mints_notes_for_the_recipient` | happy path private mint | PORT-AS-IS | `claim_private_via_relayer_mints_to_recipient` (already relayer-shaped in V1) | S |
| `claim_private_redirect_to_another_recipient_rejected` | F-007: can't redirect | PORT-AS-IS | `claim_private_relayer_redirect_rejected` | S |
| `claim_private_message_from_portal_a_cannot_mint_token_b` | cross-token isolation | DROP (hub-only) | N/A | — |
| `claim_private_two_tokens_credit_independently` | two tokens | DROP (hub-only) | N/A | — |
| `claim_private_unregistered_token_reverts` | unregistered token | DROP (no registration in V1) | N/A | — |
| `claim_private_zero_amount_rejected` | amount=0 rejected | **ADAPT — V1 GAP**: V1's `main.nr::claim_private` has `assert(amount > 0, …)` but no test exercises it (only the public path's zero-amount is tested) | GAP | S |
| `claim_private_zero_recipient_rejected` | recipient=0 rejected | PORT-AS-IS | `claim_private_zero_recipient_rejected` | S |
| `claim_private_wrong_salt_rejected` | wrong salt → wrong derived secret | PORT-AS-IS | `claim_private_wrong_salt_rejected` | S |
| `claim_private_replay_rejected` | nullifier replay | PORT-AS-IS | `claim_private_double_claim_rejected` | S |
| `claim_private_by_relayer_credits_the_recipient` | relayer submits, funds go to recipient not relayer, explicit balance check on BOTH parties | PORT-AS-IS (V1 asserts recipient balance only, not that the relayer got nothing — minor strengthening, same file) | `claim_private_via_relayer_mints_to_recipient` | S |

### exits.nr (13 tests) — concept: exits (burn + L2→L1 message)

| Test | Property | Verdict | V1 equivalent | Effort |
|---|---|---|---|---|
| `exit_public_burns_the_caller_balance` | public exit burns exactly amount | PORT-AS-IS | `exit_to_l1_public_burns_caller_balance` | S |
| `exit_private_burns_the_private_balance` | private exit burns notes | PORT-AS-IS | `exit_to_l1_private_burns_private_balance` | S |
| `exit_public_authwit_for_token_a_replayed_against_token_b_rejected` | authwit scoped to token, not reusable cross-token | DROP (hub-only, single token in V1 has nothing to replay against) | N/A | — |
| `exit_private_authwit_for_token_a_replayed_against_token_b_rejected` | same, private | DROP | N/A | — |
| `exit_public_without_authwit_rejected` | exit dies with `"unauthorized"` if caller never granted the burn authwit | **ADAPT — V1 GAP**: every V1 exit test authorizes first; V1 has no test of the bare "forgot to authorize" path even though `Token.burn_public` enforces it the same way (proxy sees msg_sender==proxy, same authwit-consumer shape) | GAP | S |
| `exit_public_unregistered_token_reverts` | unregistered token | DROP | N/A | — |
| `exit_private_unregistered_token_reverts` | unregistered token | DROP | N/A | — |
| `exit_public_zero_recipient_rejected` | L1 recipient=0 rejected | PORT-AS-IS | `exit_to_l1_public_zero_recipient_rejected` | S |
| `exit_private_zero_recipient_rejected` | same, private | PORT-AS-IS | `exit_to_l1_private_zero_recipient_rejected` | S |
| `exit_public_zero_amount_rejected` | amount=0 rejected | **ADAPT — V1 GAP**: code has the assert, no test | GAP | S |
| `exit_private_zero_amount_rejected` | same, private | **ADAPT — V1 GAP** | GAP | S |
| `exit_public_insufficient_balance_rejected` | over-exit dies on the burn (`"attempt to subtract with overflow"`), never emits withdraw for undestroyed value | PORT-AS-IS | `exit_to_l1_public_insufficient_balance_rejected` (same exact string) | S |
| `exit_private_insufficient_balance_rejected` | same, private (`"Balance too low"`) | PORT-AS-IS | `exit_to_l1_private_insufficient_balance_rejected` (same exact string) | S |

### guards.nr (3 tests) — concept: `#[only_self]` static guards

| Test | Property | Verdict | V1 equivalent | Effort |
|---|---|---|---|---|
| `_register_only_self` | direct stranger call to an `only_self` fn rejected | **ADAPT — V1 GAP**: V1's `TokenBridge::_assert_not_paused` and `TokenMinterProxy::assert_bridge` are both `#[only_self]` and NEITHER has a direct-call test; only exercised indirectly through the enqueue-self path in happy-path tests | GAP (both fns) | S |
| `_register_only_self_even_for_guardian` | even a privileged actor (guardian) can't bypass only_self | **ADAPT — V1 GAP**: no V1 test proves the *admin* (owner) can't directly call `_assert_not_paused` or `assert_bridge` either — the same "privileged-but-not-self" shape | GAP | S |
| `_assert_exits_open_only_self` | same pattern, second only_self fn | ADAPT (fold into the above for `_assert_not_paused`) | GAP | S |

### pause.nr (8 tests) — concept: pause / guardian authority

| Test | Property | Verdict | V1 equivalent | Effort |
|---|---|---|---|---|
| `non_guardian_cannot_pause` | stranger can't pause | PORT-AS-IS (V1: owner-gated `set_paused`, same shape) | none by this exact name, but `proxy_unwired_non_owner_set_bridge_rejected`-style coverage exists for the proxy; **no direct "non-owner cannot set_paused" test on TokenBridge itself** — GAP | GAP | S |
| `admin_is_not_the_guardian` | the deployer/admin has no special pause power beyond being owner | N/A shape mismatch — in V1 admin IS the owner IS the pauser (no separate guardian role); DROP as a distinct test, but see gap above | N/A | — |
| `public_exit_rejected_while_paused` | pause blocks public exit | PORT-AS-IS | `exit_to_l1_public_paused_rejected` | S |
| `private_exit_rejected_while_paused` | pause blocks private exit (via enqueued public assert) | PORT-AS-IS | `exit_to_l1_private_paused_rejected` | S |
| `claims_unaffected_while_paused` | claims (public+private) unaffected by pause | **ADAPT — V1 GAP**: V1 pauses claims too (its `set_paused` gates BOTH claim_public/claim_private AND exits — see `claim_public_paused_rejected`/`claim_private_paused_rejected`), so this is a genuine **design divergence**, not a portable test: V1's pause is bridge-wide, V2's hub pause is exit-only by design (guardian "never pauses claims" per brief). Do NOT port this test verbatim — it would FAIL against V1 (V1 intentionally pauses claims too). Flag for the port list as a note, not a test to add. | N/A (contradicts V1 design) | — |
| `registration_unaffected_while_paused` | registration proceeds while exits paused | DROP (no registration in V1) | N/A | — |
| `exits_resume_after_unpause` | unpause restores exits | PORT-AS-IS | `claim_public_unpause_restores_claims` covers the claim side; **no exit-side unpause-restores test exists in V1** — GAP | GAP | S |
| `exits_paused_view_tracks_the_switch` | pause state view reads correctly through toggles | **ADAPT — V1 GAP**: V1 has `get_config_public()` view test (in ownership.nr, incidental) but no dedicated "is_paused view tracks set_paused toggles" test | GAP | S |

### keystone.nr (2 tests) — concept: keystone / cross-toolchain address derivation

| Test | Property | Verdict | V1 equivalent | Effort |
|---|---|---|---|---|
| `keystone_hub_token_address_matches_bridge_core` | in-circuit Token-instance derivation == TS `getContractInstanceFromInstantiationParams` | DROP — V1 has no address-derivation library method at all (V1's token is deployed once by the human-run deploy conductor, not derived in-circuit); nothing to pin | N/A | — |
| `keystone_oversized_word_is_rejected` | `word_to_str`'s 31-byte decomposition range-checks | DROP (V1 has no `word_to_str`/`FieldCompressedString` word-encoding path — no L1-attested name/symbol words at all) | N/A | — |

### register.nr (19 tests) — concept: hub registration / per-token derivation

All 19 are **DROP** for V1: `register_and_claim_public_in_one_tx`, `claim_private_after_registration`, `wrong_metadata_fails_before_any_side_effect`, `bind_token_alone_registers`, `register_from_foreign_sender_rejected`, `register_with_swapped_portal_rejected`, `register_replay_of_same_leaf_rejected`, `second_factory_leaf_for_same_erc20_rejected`, `relayer_registers_then_depositor_claims`, `register_and_claim_for_registered_token_rejected`, `bind_cannot_consume_a_real_factory_leaf`, `register_token_reaches_the_publish`, `register_and_claim_public_reaches_the_publish`, `register_with_swapped_words_rejected`, `register_with_wrong_name_word_rejected`, `second_factory_leaf_with_same_words_different_portal_rejected`, `two_tokens_register_independently`, `discovery_reads_zero_for_unregistered`, `decimals_extremes_register`.

Why DROP: V1's `TokenBridge` is bound to ONE already-deployed token at construction (`Config{token_minter_proxy, portal}`, `PublicImmutable`, set once by `constructor`). There is no L1 `PortalFactory`, no `register` message, no in-circuit `Token` derivation/publish, no `token_of`/`portal_of` maps, no "first-registration-wins" race, no harness-vs-production secret split (`REGISTER_SECRET`/`BIND_HARNESS_SECRET`). None of these 19 tests have ANY analog surface in V1's contracts — porting them would require building the hub architecture itself, which is explicitly out of scope (V1 ships the single-token design). If in the future V1 grows a factory/hub, this whole file plus `register_hash` becomes the template — worth keeping as reference, not porting now.

**Summary counts**: PORT-AS-IS 15, ADAPT (genuine V1 gap — code already correct, test missing) 12, DROP 38 (36 hub/registration-only + 1 design-incompatible pause test + the class-id/derivation keystones already covered by an existing different mechanism, see §4). New-gap ADAPT tests total effort: all S (small — each is a copy of an existing test shape with one assertion changed), so **~12 small tests, well under a day** to close every identified V1 coverage gap.

---

## 2. `txe-manifest.txt` / `txe-ts-map.md`

**`txe-manifest.txt`** (one bare test name per line, 65 lines, alphabetically sorted) is a **pass-criteria manifest**, not a build list: `scripts/run-txe-tests.sh` (when run with no `-- <filter>` args) requires (a) the file exists, (b) it names at least a **floor of 40** tests (`floor=40` in the script — a hardcoded regression tripwire so an emptied manifest can't silently pass), and (c) for every named test, the raw nargo log (`Testing …::<name> ... ok`, ANSI-stripped, anchored on the `::` module separator so a longer name can't satisfy a shorter one) shows it passed. This exists because `nargo test` exits 0 even when zero tests ran (e.g. a dropped `mod test;`) or when a `should_fail` test "passes" vacuously on an infra error (the TXE oracle dying mid-run) — the manifest turns "some tests passed" into "exactly these named tests passed." It is enforced by the script itself (a shell gate), not by a separate CI job — TXE stays local-only, never runs in `_bridge-contracts.yml` (confirmed: the `noir` CI job only runs the oracle-free `keystone` crate; `implementations-plan/any-erc20-bridge/brief.md` "Out of scope: TXE in CI (stays a local per-phase gate)").

**`txe-ts-map.md`** is a **property → test → cross-boundary-counterpart map** (markdown table), a reviewer aid: for every property that crosses the L1↔L2 boundary, it names the TXE test AND the Solidity/TS test that pins the same property on the other side (e.g. "recipient inside content hash" → `claim_public_wrong_recipient_rejected` (Noir) ↔ `ContentHash.t.sol` (Solidity) + `PortalRoundtripFuzz` (Solidity fuzz)). It is documentation, not machine-enforced — no script checks it stays in sync with the test files; its value is purely as an audit/review artifact.

**Adopt for V1**: yes, both, cheaply.
- `txe-manifest.txt`: trivial to add — list V1's (33 + however many of the 12 gap-tests get added) names, wire `run-txe-tests.sh` (once ported, see §3) to check it. This is a pure safety net with no design cost.
- `txe-ts-map.md`: worth writing once (V1 already HAS the L1/TS counterparts — `ContentHash.t.sol`, `claim-secret.ts` — the map is new documentation, not new code), medium effort (a few hours to enumerate V1's ~21-33 properties against their L1/TS pins).

---

## 3. `txe-server/` package and `run-txe-tests.sh`/`nargo-5.sh` changes

**Problem in V1**: `run-txe-tests.sh` installed `@aztec/txe@5.0.1` ad hoc into a cache dir (`$HOME/.cache/nulo-txe/5.0.1`) via `bun add` on first run — an unpinned, uncommitted, machine-local install; its transitive dependency tree is not tracked anywhere and could drift silently between machines/CI runs (supply-chain and reproducibility risk, and a shared-cache race if two agents on the same box both first-run at once).

**V2's fix**: `contracts/bridge/aztec/txe-server/` is a tiny committed package (`package.json` pinning `@aztec/txe@5.0.1`, plus a committed `bun.lock`) INSIDE the crate directory (`TXE_PKG_DIR="$here/txe-server"`, not a home-dir cache). `run-txe-tests.sh` installs it with `bun install --frozen-lockfile`, so the exact dependency graph is git-tracked and reproducible; a lockfile drift fails loudly instead of silently re-resolving. This is a pure reliability/supply-chain win with no design trade-off — **adopt as-is** (create `contracts/bridge/aztec/txe-server/package.json`+`bun.lock` for token_bridge, same shape).

**`nargo-5.sh`** is new in V2 — a thin wrapper (`scripts/nargo-5.sh <crate-dir> <nargo-args>`) that runs the pinned 5.0.1 `aztec-nargo` from any crate dir. It centralizes the "always use the pinned toolchain, not whatever's on PATH" rule that V1's README states as prose but doesn't enforce as a script. Cheap, low-risk, **adopt** — trivial S effort, removes a footgun (phase-4 lessons record someone hitting exactly this: "Never type-check the hub crate with `nargo compile` … overwrites the committed TRANSPILED artifact").

**`run-txe-tests.sh` other changes** (beyond the manifest gate and `txe-server` staging):
- `--crate <name>` selector (multi-crate support) — **not needed** for V1 (single crate `token_bridge`) unless V1 later gains a second Aztec contract; low priority, skip unless porting the whole crate-selection plumbing is free.
- Thread count dropped from 4 → 2 (`TXE_TEST_THREADS`) because the TXE server's lmdb store opens with `maxReaders=2` and 4 threads aborted the whole process mid-suite on a real CI run ("four threads passed one CI run and aborted the next, after 35 tests" — phase-4 lessons). **Adopt this number for V1 too** — it's a discovered stability fact about the TXE server itself, not hub-specific, and V1 runs the identical `@aztec/txe@5.0.1` server.
- `--show-output` flag added to nargo invocation (needed for the manifest's log-grep to see per-test `... ok` lines reliably) — **adopt**, required if porting the manifest mechanism.
- Per-run free-port picking (`pick_free_port`, `TXE_PORT` env override, reuse-if-caller-pinned) — **already present in V1** (confirmed identical in the diff context, this logic predates V2 and is unchanged); no action needed.

**`compile.sh --check`** — see §4/§5, this is the biggest genuinely new mechanism and belongs with the class-id discussion.

---

## 4. Keystone at freeze vs V1, and cross-toolchain pinning mechanisms

**`keystone/src/main.nr` diff is minimal**: V2 added exactly two tests (`register_matches_l1_and_ts`, `register_secret_hash_is_pinned`) pinning the NEW `register_hash_lib` content hash against `PortalFactory.sol`/`register-hash.test.ts` — both are register/hub-only, **DROP** for V1. Every other keystone test (`mint_to_public_matches_l1`, `mint_to_private_matches_l1`, `withdraw_matches_l1`, the `derive_claim_secret` dom-sep pin + 3 vectors + hash vectors + 2 fuzz-neighbor properties) is **byte-identical** between V1 and V2 — confirmed via `git diff`, the only changes are two comment-wording edits (`token_bridge contract` → `hub contract`). **These are already PORT-AS-IS by construction — V1 already has them, verbatim, today.** `claim_secret/src/lib.nr` is also byte-identical in logic (only comment wording differs).

**Other V2-only cross-toolchain pinning: NONE beyond keystone + the class-id mechanism** (no separate "artifact digest pin" script exists beyond what's below).

**Class-id / artifact pinning — already exists in V1, confirmed by direct read of `packages/bridge-core/src/noir-artifact-classids.test.ts` at both commits**: this vitest file pins the DERIVED contract class id (bytecode+ABI on-chain identity) of every committed Noir artifact and asserts `aztecVersion === "5.0.1"`. At V1 it pins `TokenMinterProxy` (`0x07689a53…`) and `TokenBridge` (`0x2cb5c634…`); at V2 it pins `TokenBridgeHub` (`0x08e8238e…`) instead — same file, same mechanism, just swapped pins. **This existed BEFORE V1 froze** (comment: "codex ultra-audit HIGH #2" — predates the any-erc20-bridge arc). So the vitest-level pin is not new QA to port; V1 already has it.

**What IS new in V2 and genuinely worth adopting**: `compile.sh --check` + `packages/bridge-core/scripts/noir-class-id.ts` + the CI `hub-parity` job. V1's `compile.sh` had no `--check` mode — the vitest pin only catches drift if someone remembers to regenerate it by hand; nothing ever *rebuilds from source* to prove the committed artifact matches. V2's `compile.sh --check`: stages the committed `target/*.json` aside, runs the real pinned `aztec compile`, derives the fresh class id via `noir-class-id.ts`, and diffs it against the committed one — then restores the committed bytes regardless of outcome (so `--check` never dirties the tree). Verified load-bearing per phase-3 lessons ("a one-character mutation of `claim_public` reds it"). The CI `hub-parity` job runs exactly this in a clean runner with no local toolchain state. **Adopt for V1**: add `--check` to V1's existing `compile.sh` (small — mostly the diff already shown in §context is copy-portable, minus the hub-specific bits) and add an equivalent `bridge-parity` CI job. Effort **M** (script + CI job + first-run baseline verification for `token_minter_proxy`/`token_bridge`/`keystone`).

---

## 5. Static guards — `check-sole-consumer.sh` diff

V1's script checks exactly **2** `consume_l1_to_l2_message` call sites in `token_bridge/src/main.nr` (line-count based) and that `claim_private` derives its secret rather than taking a raw one. V2's rewrite (231-line diff) does the same check for **3** sites (adds `_bind`'s register consume, pinned to read `l1_factory` from storage and pick its secret from exactly `{REGISTER_SECRET, BIND_HARNESS_SECRET}` by the `publish` flag) — the 3-site logic itself is **DROP** for V1 (no register consume exists). But the script also picked up several **robustness fixes that are NOT hub-specific and directly improve the SAME 2-site check V1 already runs**:

1. **Comment-stripping before scanning** (`strip_comments`, string-literal-aware, handles `//` and `/* */` inside string literals correctly via a single string-first alternation) — V1's script currently `grep -c`s raw lines, so a commented-out bearer-shape or a stray `consume_l1_to_l2_message` mentioned in a comment can desync the count from live code. **ADAPT, adopt directly** — this is a real robustness gap in V1's guard today (the regression corpus V2 built — "Regression 11/13/14" — would defeat V1's current script if crafted against it).
2. **Occurrence-counting across every non-test `.nr` file in the crate** (`find … -not -path '*/test/*' … | grep -o … | wc -l`) instead of line-counting one file — catches a second consume site hidden in a helper file, and catches two consume calls on one line (V2's "Regression 9"). **ADAPT, adopt directly.**
3. **Expanded self-test regression corpus**: V1's self-test currently rejects 5 crafted bearer regressions; V2's rejects 14 (9 are hub-shape-specific and DROP, but regressions 9/11/13/14 — one-line double-consume, commented-out-shapes, string-literal `//`, string-literal `/* */` — are generic script-robustness tests that apply to ANY crate's sole-consumer check). **ADAPT, adopt those 4.**

No other new static-check family was added in V2 (no separate authwit/`#[only_self]`/function-inventory/storage-layout script — the `#[only_self]` coverage gap identified in §1 (guards.nr) is closed by writing TXE *tests*, not a new static script). `compile.sh --check` (§4) is the only other new static guard.

**Adopt for V1**: port items 1–3 above into V1's existing `check-sole-consumer.sh` verbatim (they're crate-shape-agnostic string/regex plumbing); effort **S–M** (mechanical, well-specified by the diff already captured above).

---

## 6. Findings from `audit/` and `implementations-plan/` that motivated V2's Aztec.nr tests

**Timing matters**: `implementations-plan/bridge-security-remediation` (2026-06-17, F-002 single-minter proxy) and `implementations-plan/bridge-permit2-recipient-commitment` (2026-07-21, F-007 recipient-committed private claims) **both predate V1's freeze** (2026-09-02) — their findings are already fully implemented AND tested in V1 today (`proxy_guards.nr`'s "F-002" comments, `claims_private.nr`'s "F-007 recipient-commitment property" comment, `claim_secret/src/lib.nr`'s F-007 doc comment — all present verbatim in V1). **Nothing to port here; these are the shared baseline both V1 and V2 build on.**

**Findings that actually drove V2's NEW tests** (from `implementations-plan/any-erc20-bridge/{brief,audit-codex-final,audit-fable}.md`, all hub/registration-specific, all **DROP** for V1 since the vulnerability class doesn't exist without a factory/registration surface):
- **audit-fable "S1" (per-token wallet capability model)**, **"I4"/"R2-C1" (register race — a second factory leaf for one ERC-20 must be rejected, `token_of`'s init-nullifier)**, **"C1" (1-tx register+claim testability)**, **"S7"/"C7" (typed re-serialization for address derivation, not `get_args_hash()`)** → these motivated `register.nr`'s replay/race tests and the `keystone_hub_token_address_matches_bridge_core` test. All registration-only.
- **The Arc-2 quality-loop finding recorded in `lessons/phase-4.md`** (the material one): the publish-free `bind_*` harness entrypoints, as originally written, could consume a REAL factory-committed leaf (`compute_secret_hash([0])`) without publishing the Token instance — fixed by splitting the consumption secret by a `publish` flag (`REGISTER_SECRET` vs `BIND_HARNESS_SECRET`) and pinned by `check-sole-consumer.sh`'s 3rd-site checks. This is a genuine security bug V2's own hardening loop found and fixed **in hub-only code that has no V1 counterpart** (V1 has no test-harness-vs-production entrypoint split at all — its TXE tests drive the real `claim_public`/`claim_private` directly). **DROP, but worth remembering as a design lesson**: if V1 or any future contract ever grows a "test-only bind" entrypoint alongside a production one, split their consumption secrets exactly this way.

**Findings that DO generalize to V1** (not new discoveries, but confirm V1's existing design choices are sound and already tested):
- Zero-amount / zero-recipient / paused / replay / wrong-secret / wrong-recipient guards — universal to any L1↔L2 message-consuming bridge, already covered on both sides (§1).
- The "exact `should_fail_with` string" discipline (`implementations-plan/any-erc20-bridge/lessons/phase-4.md`'s "Exact strings" table) — V1 already follows this convention (every V1 `should_fail_with` is a literal string, confirmed by reading all 5 V1 test files); no gap.

**`implementations-plan/tools-extraction`** (checked: `plan.md`/`recon.md`) is about extracting UI tooling code, not Aztec.nr contracts — **no Aztec.nr findings**, confirmed by directory contents (only `lessons/phase-1.md`, `plan.md`, `recon.md`, `.gitignore`).

---

## 7. Final port list

| Item | Property | Source | Effort | Notes |
|---|---|---|---|---|
| **12 new V1 TXE tests** (§1 ADAPT rows) | `claim_public_wrong_amount_rejected`, `claim_public_by_relayer_credits_the_recipient`, `claim_private_zero_amount_rejected`, `exit_*_without_authwit_rejected` (×1, public only — private analog optional), `exit_*_zero_amount_rejected` (×2), `_assert_not_paused` / `assert_bridge` direct-call-rejected (×2, stranger + owner), `non_owner_cannot_pause` (TokenBridge), `exits_resume_after_unpause` (dedicated), `is_paused` view-tracks-toggle | V2-adapted (copy V2's test shape, drop the two-token/hub bits) | S each, ~1 day total | None expose a bug — V1's contract code already has every assert these test; pure coverage debt |
| `txe-manifest.txt` for `token_bridge` | pass-criteria floor + named-test gate | V2-adapted mechanism | S | Wire into `run-txe-tests.sh` |
| `txe-ts-map.md` for `token_bridge`+`token_minter_proxy` | property → TXE test → L1/TS counterpart doc | V2-adapted mechanism (new doc, V1 already has the L1/TS pins to reference) | M | Documentation only |
| `contracts/bridge/aztec/txe-server/{package.json,bun.lock}` | committed, frozen-lockfile TXE oracle server dependency | V2 (direct copy, same `@aztec/txe@5.0.1` pin) | S | Reliability/supply-chain fix |
| `scripts/nargo-5.sh` | pinned-toolchain wrapper | V2 (direct copy) | S | Removes a documented footgun |
| `run-txe-tests.sh`: `TXE_TEST_THREADS` default 4→2, `--show-output`, manifest-gate logic, `TXE_PKG_DIR` → `txe-server/` | TXE server stability + manifest enforcement | V2-adapted | S–M | Thread-count fact applies to V1's identical TXE server |
| `check-sole-consumer.sh`: comment-stripping, whole-crate occurrence counting, 4 generic regression tests | robustness of the EXISTING 2-site F-007 guard | V2-adapted (strip the 3-site/hub logic) | S–M | Closes a real gap in V1's current guard (crafted comment/string regressions would defeat it today) |
| `compile.sh --check` + `packages/bridge-core/scripts/noir-class-id.ts` + `bridge-parity` CI job | rebuild-from-source class-id parity, vs. today's hand-maintained vitest pin | V2-adapted (direct port, minus hub-specific crate list) | M | Genuinely new mechanism; V1 only has the passive vitest pin today |
| `keystone` register vectors, `register_hash` lib, `token_bridge_hub`, all 19 `register.nr` tests, both `keystone.nr` hub tests, `guards.nr`'s `_register_only_self[_even_for_guardian]`, two-token isolation tests in claims/claims_private/exits, `pause.nr`'s `claims_unaffected_while_paused`/`registration_unaffected_while_paused`/`admin_is_not_the_guardian` | hub/registration/multi-token design | **NOT applicable — DROP** | — | V1 ships the single-token design; these require building the hub architecture, explicitly out of scope |

### Critical bug-exposure check (explicit answer to the flagged ask)

**No V2 TXE test, when translated to V1's actual `token_bridge`/`token_minter_proxy` contracts, would fail.** I traced every ADAPT-marked property (§1) against V1's `main.nr` source read in full at `4df5eae5`: `claim_public`/`claim_private`/`exit_to_l1_public`/`exit_to_l1_private` all already contain the `amount > 0`, `!recipient.is_zero()`, pause, and authwit-consumption guards that the corresponding V2 tests would exercise — they are simply untested in V1 today, not unenforced. The one V2 test that would genuinely conflict with V1's design (`claims_unaffected_while_paused`) reflects a **deliberate architecture difference** (V1's single `is_paused` gates claims AND exits; V2's hub splits into an ever-claimable/pausable-exits-only model) — not a bug, a different design V1 already ships and tests (`claim_public_paused_rejected`, `claim_private_paused_rejected`). The one real security bug V2's hardening loop found (the harness-secret bind-entrypoint leak, `lessons/phase-4.md`) lives entirely in hub-only code with no structural analog in V1 (V1 has no harness/production entrypoint split). **Conclusion: shipping V1's contracts as-is carries no known-and-unfixed bug that V2's QA surfaced — the gap is purely test coverage (12 small tests) and tooling robustness (manifest, txe-server pinning, compile.sh --check, sole-consumer hardening), not contract logic.**

