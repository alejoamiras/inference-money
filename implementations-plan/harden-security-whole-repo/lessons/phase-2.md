# Phase 2: `--no-env-file` and the three routed bugs

Gate (2026-10-02): `bun run lint`, `bun run typecheck`, `bun run test`, `bun run lint:actions` and `bun run test:evm:formal` exit 0 ("exactly the 11 expected proofs passed"); `bun run test:integration` exits 0 (43 pass, 0 fail, 20 min) on a network of its own.

## What bit

- **The cached node install pointed at a removed worktree.** `install-node.sh` links `<dir>/node_modules` to the checkout's `packages/local-network/toolchain/node_modules`, so an install made from one worktree dies with it. Each worktree needs its own: `bash packages/local-network/scripts/install-node.sh ~/.cache/inference-money/aztec-node-<slug>` and `AZTEC_NODE_HOME=<that dir>`.
- **biome reformats a long one-line arrow in a test.** `bun run lint` caught it; `bunx biome check --write <file>` fixes it. The pre-commit hook would have too, but the gate runs first.
- **The integration suite prints nothing per test until the end.** 20 minutes of a quiet log is normal; check the process, not the log.

## The four changes

- **`--no-env-file`.** Bun loads a working-directory `.env` before any code runs, and `process.execArgv` is the only place the CLI can see the flag. The guard sits before argument parsing, so even `bun packages/deployer/src/cli.ts` with no command refuses. The redacted child and the remapping check (the deployer's only two Bun children) pass the flag. Not covered: `forge` loads a `.env` from `contracts/evm` on its own, and nothing in the repo can turn that off.
- **Start times in UTC.** `ps -o lstart=` prints in the caller's zone and locale; `TZ=UTC LC_ALL=C` fixes both. A record written by the old code holds the caller's own zone, so `groupState` also accepts that reading: without it, the first teardown after the upgrade on a non-UTC host would read every live group as reused and drop its handle. During the upgrade window two runs on different code can each read the other's registry lock as held by a dead process (the lock names its holder by the same text); that needs both to contend within the lock's milliseconds on a non-UTC host, and the error names the file to remove.
- **A revert's finality.** `locateWithdrawal` returns `"reverted"` only when the receipt is finalized and `"reverted-unfinalized"` before; the two error classes carry `final`. The showcase lists a rejected burn as stuck, with a note, until the revert is final. A return needs no record: `depositFate` finds a re-included return from the deposit ticket alone.
- **The launcher's anvil.** Confirmed on a live network: `anvil --silent --port 8545` in the node's process group, listening on 127.0.0.1:8545, reaped at teardown. The launcher reads `ANVIL_PORT` and has no switch to skip its anvil. Aimed at the port the run's own anvil already holds, the copy fails with "Address already in use" and exits; confirmed again on a live network (one listener, the run's own). It relies on the two binds colliding, which holds on Linux; on macOS a duplicate bind of the same address without `SO_REUSEPORT` is refused too, but that was not run here.

## Decisions

- The time-zone fix keeps the `started` field a string and the handle schema unchanged: an older checkout can still read a newer handle.
- `ExitRevertedError` keeps its message for both cases; `final` is for the caller's bookkeeping, and the text shown to a user is true either way.
- The stray anvil is removed by a collision rather than given a fifth claimed port: no handle or registry change, and no idle chain per run. A launcher that one day waits for its own anvil would fail the boot loudly on the version bump.
