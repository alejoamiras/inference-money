# CI pipeline

Every workflow defaults to `permissions: contents: read`, pins actions by commit SHA, and holds no secrets. Deploys never run from Actions.

| Workflow | Trigger | What it gates |
|---|---|---|
| `actionlint.yml` | PRs touching `.github/**` or shell scripts | actionlint + shellcheck |
| `contracts.yml` → `_contracts.yml` | PRs touching `contracts/**`, toolchain pins, the lockfile or these workflows | `evm`: forge fmt/lint/unit/fuzz/invariant, gas snapshot, strict halmos. `noir`: pinned-dep fetch + verify from an empty `~/nargo`, `compile.sh --check`, manifest-gated TXE (token_bridge + keystone), sole-consumer guard, `--exact` (nothing unpinned fetched), clean tree |

| `deployer.yml` | PRs touching `packages/deployer/**`, toolchain pins, the lockfile or this workflow | biome, typecheck, unit tests |
| `audit.yml` | PRs touching a `bun.lock` or `package.json` | `bun audit` over the workspace and `txe-server` lockfiles; advisory (not required), findings in the step summary |

Each caller ends in a `*-status` job, the one to mark required: it fails when change detection fails, and when a relevant suite ended anything but `success`. The Sepolia fork suite needs an RPC, so it runs in the local phase gate rather than in CI.

Toolchain versions come from `toolchain.json` through `.github/actions/setup-toolchains`. The Aztec installer and the nargo and bb binaries are sha256-pinned in `setup-toolchains/aztec-<version>.sha256`: bumping `noir` needs a new pin file (the release nargo and the `@aztec/bb.js` amd64-linux `bb`).
