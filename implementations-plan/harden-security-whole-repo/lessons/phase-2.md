# Phase 2: `--no-env-file` and the three routed bugs

Gate (2026-10-02): `bun run lint`, `bun run typecheck`, `bun run test`, `bun run lint:actions` and `bun run test:evm:formal` exit 0 ("exactly the 11 expected proofs passed"); `bun run test:integration` exits 0 (43 pass, 0 fail, 20 min) on a network of its own.

## What bit

- **The cached node install pointed at a removed worktree.** `install-node.sh` links `<dir>/node_modules` to the checkout's `packages/local-network/toolchain/node_modules`, so an install made from one worktree dies with it. Each worktree needs its own: `bash packages/local-network/scripts/install-node.sh ~/.cache/inference-money/aztec-node-<slug>` and `AZTEC_NODE_HOME=<that dir>`.
- **biome reformats a long one-line arrow in a test.** `bun run lint` caught it; `bunx biome check --write <file>` fixes it. The pre-commit hook would have too, but the gate runs first.
- **The integration suite prints nothing per test until the end.** 20 minutes of a quiet log is normal; check the process, not the log.

## The four changes

- **`--no-env-file`.** Bun loads a working-directory `.env` before any code runs, and `process.execArgv` is the only place the CLI can see the flag. The guard sits before argument parsing, so even `bun packages/deployer/src/cli.ts` with no command refuses. The redacted child and the remapping check (the deployer's only two Bun children) pass the flag. Not covered: `forge` loads a `.env` from `contracts/evm` on its own, and nothing in the repo can turn that off.
- **Start times in UTC.** `ps -o lstart=` prints in the caller's zone and locale; `TZ=UTC LC_ALL=C` fixes both. A record written by the old code holds the caller's own zone; when the text differs, `groupState` falls back to the marker alone (a pid is not reused while its group lives, so a member carrying the marker proves the group). That needs `/proc`: on macOS a checkout updated across this change while its own network is up reads that group as reused, so run `net:down` first there. During the upgrade window two runs on different code can each read the other's registry lock as held by a dead process (the lock names its holder by the same text); that needs both to contend within the lock's milliseconds on a non-UTC host, and the error names the file to remove.
- **A revert's finality.** `locateWithdrawal` returns `"reverted"` only when the receipt is finalized and `"reverted-unfinalized"` before; the two error classes carry `final`. The showcase lists a rejected burn as stuck, with a note, until the revert is final. A return needs no record: `depositFate` finds a re-included return from the deposit ticket alone.
- **The launcher's anvil.** Confirmed on a live network: `anvil --silent --port 8545` in the node's process group, listening on 127.0.0.1:8545, reaped at teardown. The launcher reads `ANVIL_PORT` and has no switch to skip its anvil. Aimed at the port the run's own anvil already holds, the copy fails with "Address already in use" and exits; confirmed again on a live network (one listener, the run's own). It relies on the two binds colliding, which holds on Linux; on macOS a duplicate bind of the same address without `SO_REUSEPORT` is refused too, but that was not run here.

## Decisions

- The time-zone fix keeps the `started` field a string and the handle schema unchanged: an older checkout can still read a newer handle.
- `ExitRevertedError` says "try again" only once `final`; before that it says to keep the hash and wait (review round 1).
- The stray anvil is removed by a collision rather than given a fifth claimed port: no handle or registry change, and no idle chain per run. A launcher that one day waits for its own anvil would fail the boot loudly on the version bump.

## Arc 1 Codex loop

Codex (default model, `medium`, read-only) over `9f84cdb..HEAD`.

**Round 1: 2 material, 2 minor.**

1. *Material, rejected with evidence:* "the outer `bun run` still loads `.env` into the CLI". On Bun 1.4.0 `bun run <script>` reads the file but hands none of it to the script: a script `bun --no-env-file show.ts` beside a `.env` with `SEED=7` prints `seed: null`. Adopted its test ask: `cli.test.ts` now starts the CLI through a package script too, so a Bun that changes this fails the suite.
2. *Material, accepted:* the fallback to the caller's-zone reading was no proof (a reused pid started exactly the zone offset later would match) and still read a record from a third zone as reused. Replaced by the marker: a start-time mismatch is ours only when a member carries the group's marker.
3. *Minor, accepted:* an unfinalized revert no longer says "try again"; it says to keep the hash and wait until it is final.
4. *Minor, accepted:* `claim-secret.ts` told integrators to draw the salt with `Fr.random()`; it now names `randomSecret()`.

**Round 2: 1 material.** A record written by older code in its own zone can equal the UTC reading of a reused pid to the second, and equality returned "ours" before the marker was consulted. Accepted: start times read by this code carry a `utc` tag, so an untagged record never equals one and is proven by its marker or not at all. Checked on a live network (up, status "ours", down).
