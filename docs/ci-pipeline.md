# CI pipeline

Every workflow defaults to `permissions: contents: read`, pins actions by commit SHA, and holds no secrets. Deploys never run from Actions.

| Workflow | Trigger | What it gates |
|---|---|---|
| `actionlint.yml` | PRs touching `.github/**` or shell scripts | actionlint + shellcheck |
| `contracts.yml` → `_contracts.yml` | PRs touching `contracts/**`, toolchain pins, the lockfile or these workflows | `evm`: forge fmt/lint/unit/fuzz/invariant, gas snapshot, strict halmos. `noir`: pinned-dep fetch + verify from an empty `~/nargo`, `compile.sh --check`, manifest-gated TXE (token_bridge + keystone), sole-consumer guard, `--exact` (nothing unpinned fetched), clean tree |
| `bridge-core.yml` | PRs touching `packages/bridge-core/**`, `contracts/evm/**`, the committed L2 artifacts, toolchain pins, the lockfile or this workflow | biome, typecheck, unit tests; the test script runs `forge build` first, so the ABI pins compare against fresh forge output and are never skipped |
| `local-network.yml` | PRs touching `packages/local-network/**`, toolchain pins, the lockfile or this workflow | biome, typecheck, unit tests (registry locking and reaping, owned process groups, run identity) |
| `deployer.yml` | PRs touching `packages/deployer/**`, the packages it imports (`bridge-core`, `local-network`), the committed L2 artifacts, toolchain pins, the lockfile or this workflow | biome, typecheck, unit tests. Live deploys (`net:up` → `deploy:local` → `verify:local`) need the pinned 5.0.0 node, so they run in the local phase gate |
| `integration.yml` | PRs touching `packages/integration/**`, the packages it drives (`bridge-core`, `deployer`, `local-network`), toolchain pins, the lockfile or this workflow | biome, typecheck. The specs need the pinned 5.0.0 node, so `bun run test:integration` runs in the local phase gate |
| `web.yml` → `_e2e.yml` | PRs touching `apps/web/**`, the packages it bundles or runs against (`bridge-core`, `local-network`, `deployer`), the committed L2 artifacts or testnet manifest, toolchain pins, the lockfile or these workflows; `labeled` re-runs it | `web`: biome, typecheck, component tests, `build:testnet` with its manifest identity check. `e2e`, only on the `e2e` label or a manual dispatch: the full browser suite (`bun run test:e2e`) against its own local network, state dir uploaded on failure |
| `audit.yml` | PRs touching a `bun.lock` or `package.json` | `bun audit` over the workspace, `contracts/aztec/toolchain` and `packages/local-network/toolchain` lockfiles; advisory (not required), findings in the step summary |

Each caller ends in a `*-status` job, the one to mark required: it fails when change detection fails, and when a relevant suite ended anything but `success`. The Sepolia fork suite needs an RPC, so it runs in the local phase gate rather than in CI.

Toolchain versions come from `toolchain.json` through `.github/actions/setup-toolchains`. CI never runs the aztec-up installer (unpinned remote scripts, an unlocked npm install): the aztec CLI, bb and the TXE server come from `contracts/aztec/toolchain`'s frozen lockfile, and nargo is the noir-lang release tarball, sha256-pinned in `setup-toolchains/nargo-<version>.sha256`. Bumping `noir` means bumping `@aztec/aztec` in that lockfile and `nargo` (with a new pin file) together.

The local network's node (`aztecNode`) comes the same way: `packages/local-network/scripts/install-node.sh` installs `packages/local-network/toolchain`'s frozen lockfile (migrated from aztec-up's own npm lock, so CI and a local aztec-up install run the same tree) and the Foundry release that node ships with (`aztecNodeFoundry`, sha256-pinned in `toolchain/foundry-<version>.sha256`), then points `AZTEC_NODE_HOME` at them. Bumping `aztecNode` means regenerating that lockfile from the new aztec-up install and re-pinning its Foundry together.
