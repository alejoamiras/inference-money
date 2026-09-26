# CI pipeline

Every workflow defaults to `permissions: contents: read`, pins actions by commit SHA, and holds no secrets. Deploys never run from Actions.

| Workflow | Trigger | What it gates |
|---|---|---|
| `actionlint.yml` | PRs touching `.github/**` or shell scripts | actionlint + shellcheck |
| `contracts.yml` → `_contracts.yml` | PRs touching `contracts/**`, toolchain pins, the lockfile or these workflows | `evm`: forge fmt/lint/unit/fuzz/invariant, gas snapshot, strict halmos. `noir`: pinned-dep fetch + verify from an empty `~/nargo`, `compile.sh --check`, manifest-gated TXE (token_bridge + keystone), sole-consumer guard, `--exact` (nothing unpinned fetched), clean tree |
| `bridge-core.yml` | PRs touching `packages/bridge-core/**`, `contracts/evm/**`, the committed L2 artifacts, toolchain pins, the lockfile or this workflow | biome, typecheck, unit tests; the test script runs `forge build` first, so the ABI pins compare against fresh forge output and are never skipped |
| `local-network.yml` | PRs touching `packages/local-network/**`, toolchain pins, the lockfile or this workflow | biome, typecheck, unit tests (registry locking and reaping, owned process groups, run identity) |
| `deployer.yml` | PRs touching `packages/deployer/**`, the packages it imports (`bridge-core`, `local-network`), the committed L2 artifacts, toolchain pins, the lockfile or this workflow | biome, typecheck, unit tests. Live deploys (`net:up` → `deploy:local` → `verify:local`) need the pinned 5.0.0 node, so they run in the local phase gate |
| `audit.yml` | PRs touching a `bun.lock` or `package.json` | `bun audit` over the workspace and `contracts/aztec/toolchain` lockfiles; advisory (not required), findings in the step summary |

Each caller ends in a `*-status` job, the one to mark required: it fails when change detection fails, and when a relevant suite ended anything but `success`. The Sepolia fork suite needs an RPC, so it runs in the local phase gate rather than in CI.

Toolchain versions come from `toolchain.json` through `.github/actions/setup-toolchains`. CI never runs the aztec-up installer (unpinned remote scripts, an unlocked npm install): the aztec CLI, bb and the TXE server come from `contracts/aztec/toolchain`'s frozen lockfile, and nargo is the noir-lang release tarball, sha256-pinned in `setup-toolchains/nargo-<version>.sha256`. Bumping `noir` means bumping `@aztec/aztec` in that lockfile and `nargo` (with a new pin file) together.
