# Phase 3 — L2 contracts + V2 QA Aztec.nr port

Status: **green 2026-09-26** (gate evidence below).

## Gate evidence

`bash contracts/aztec/scripts/noir-deps.sh --self-test && bash contracts/aztec/scripts/noir-deps.sh && bash contracts/aztec/scripts/compile.sh --check && bun run test:noir && bash contracts/aztec/scripts/check-sole-consumer.sh --self-test && bash contracts/aztec/scripts/check-sole-consumer.sh` → exit 0 on the committed tree, `git status` clean afterwards.

- **Class ids reproduce V1 exactly**, and so does the SDK-facing ABI (`artifact-identity.ts compare` against V1's artifacts): TokenBridge `0x2cb5c6341bbae9bb0e78b64cfdd724cb493cc35dca46b122280fdf223b3d8713`, TokenMinterProxy `0x07689a539bf0a60a252f9b88406d5a4b129f192f7da37ab181c7a2be6910524a`. Re-checked after the comment scrub.
- **TXE**: token_bridge 47/47 (V1's 33 + the 14 new), keystone 8/8, both through the manifest gate (floors 47 and 8).
- **Keystone literals** equal `ContentHash.t.sol`'s `MINT_TO_PUBLIC`, `MINT_TO_PRIVATE` and `WITHDRAW` byte for byte.
- **Sole-consumer**: the real source passes; 11 regressions are rejected, each for its intended reason (printed by `--self-test`).

## What was built

- The four crates, copied from V1, with only comments and a test-token name changed (finding ids, plan phases and old repo names removed; the `nulo_` domain-separator string is load-bearing and stays).
- `scripts/toolchain.sh` (sourced): resolves the pinned toolchain from `toolchain.json`. Used by `nargo-5.sh`, `compile.sh` and `run-txe-tests.sh`.
- `noir-deps.sh`: pinned table of the 5 git deps (3 transitive) from a clean-cache probe; fetch → verify (HEAD == pin, clean tree). `--verify --exact` also fails on any unpinned cache entry.
- `compile.sh --check`: compares against the **HEAD** artifacts (`git show`), restores the working tree.
- `artifact-identity.ts` + test: the `claim_public` rename keeps the class id equal and fails `compare` (exit 1), the path `--check` takes.
- `run-txe-tests.sh`: `--crate token_bridge|keystone`, a committed `txe-server/` (frozen lockfile), a per-run port, owned-pid teardown, the manifest gate.
- 14 new TXE tests, plus the relayer's private and public balance asserted 0 in `claim_private_via_relayer_mints_to_recipient`.
- CI `noir` job; `docs/assurance-map.md`.

## Decisions and deviations

1. **`--exact` + an uncached `~/nargo` in CI.** The plan asked for a clean cache. A clean cache alone does not prove the pinned table is complete: nargo fetches a missing transitive dep on demand, unverified. So CI ends with `noir-deps.sh --verify --exact`, which fails if anything outside the table was fetched. Locally `--exact` is not usable: this host's `~/nargo` is shared across projects (it lists other tags).
2. **The rename regression runs at the CLI level, not through a full `compile.sh --check`.** `compare` is the exact function `--check` calls; driving it through a rebuild would add ~1 min to every unit run for no extra coverage.
3. **The private no-authwit error is an oracle error.** `exit_private_without_authwit_rejected` fails with `Unknown auth witness for message hash`: during private execution the token asks the oracle for the witness. The public path fails with `unauthorized`.
4. **Manifest regex.** V2's `Testing [A-Za-z0-9_:]*::name` required a module path; keystone's tests are root-level and print none. It is now `Testing ([A-Za-z0-9_]+::)*name`, still anchored so a longer name ending in `name` cannot satisfy it.
5. **Node pinned in `toolchain.json` (`24.12.0`).** The Aztec 5.0.1 installer exits unless node meets its manifest minimum (`24.12.0`), and ubuntu runners ship older. The action now uses `install.aztec-labs.com`, the host `aztec-up` itself uses; `install.aztec.network` answers with a 301.
6. **Test names follow the plan** (`exit_{public,private}_…`), though V1's own exit tests use `exit_to_l1_…`.

## Attempts that failed

- **`aztec compile` skipped the build** ("No source changes detected"): the copied V1 artifacts were newer than the sources. `compile.sh` now always clears `target/*.json` first.
- **The first sole-consumer self-test passed vacuously.** Every fixture shared one directory, and the crate-wide count scanned all of them, so all nine rejected on "found 20". Each fixture now gets its own directory, and the self-test prints each rejection reason so this cannot recur silently.
- **The first `noir-deps.sh --self-test` failed**: `git tag` wanted a message (the host signs tags), and the EXIT trap referenced a `local`. Then `--exact` missed its own fixture because of the `file://` double slash. All fixed.
- **Perl locale warnings** (this host's `LC_CTYPE=UTF-8`) came from the path scrub and the comment stripper; both now run under `LC_ALL=C`.
