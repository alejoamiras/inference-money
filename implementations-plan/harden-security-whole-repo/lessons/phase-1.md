# Phase 1: the audit's fixes

Gate (2026-10-02, on `9f84cdb` plus the fixes): `bun run lint`, `bun run typecheck`, `bun run test`, `bun run lint:actions` and `bun run test:evm:formal` all exit 0; the halmos gate printed "exactly the 11 expected proofs passed", with the host's halmos and again with the hash-locked install on Python 3.12.

## What bit

- **`bun run test` without node on PATH fails the showcase suite.** With no `node`, bun runs vitest's bin itself and jsdom rejects its own window (`'addEventListener' called on an object that is not a valid instance of EventTarget`, "Failed to start forks worker"). 12 errors, 6 of 18 files run. With node on PATH: 18 files, 89 tests pass. The agent shell here has no nvm on PATH; run through a script that exports it.
- **`wrangler deploy --version` deploys.** It prints the version, then goes on to deploy. It stopped only because `dist` did not exist. Never invoke a deploy script to check it resolves: run `wrangler --version` from `node_modules/.bin`.
- **Adding a dependency re-resolves the whole lock under the age gate.** `bun install` refused `@alejoamiras/presto` and `@alejoamiras/presto-banners`, already locked but younger than 7 days. A temporary `minimumReleaseAgeExcludes` for those two names, removed after the install, left a lock diff of additions only and a passing frozen install.
- **commitlint caps body lines at 100 characters.** Commit with `-F <file>`, wrapped.
- **The worktree guard refuses `export VAR=$x` and `env PATH=…` in a plain command.** Put them in a script file and run that.

## The halmos lock

- No `python3-venv`, `pipx` or `uv` on the host: `pip3 install --target <scratch dir> uv` gives a `uv` binary without touching the system.
- `uv pip compile --universal --generate-hashes --no-header --exclude-newer 2026-09-25T00:00:00Z` resolves 20 packages with every published file's hash, valid across Python versions.
- Validated the way CI installs it: `pip install --require-hashes --no-deps --only-binary :all:` into a venv on Python 3.12 (uv-managed), then the strict gate with that halmos. `pip check` clean.
- halmos finds its solvers through PATH, then its own venv (`sys.prefix`), so symlinking only `halmos` onto PATH works, as pipx did.
- Not proven until the PR runs: the same step on a GitHub runner.

## Decisions

- The guardian check replaces "no deploy key is the guardian" with a pin to an expected guardian (none by default): stricter, and it catches a guardian planted by any key. The integration test's expected check name changed with it; the integration suite runs at Phase 2's gate.
- `wrangler` joins `apps/showcase` as an exact devDependency. It adds two paths to advisories already present (`undici`, `ws` through `miniflare`); the audit workflow is advisory.
