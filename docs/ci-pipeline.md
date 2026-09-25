# CI pipeline

Every workflow defaults to `permissions: contents: read`, pins actions by commit SHA, and holds no secrets. Deploys never run from Actions.

| Workflow | Trigger | What it gates |
|---|---|---|
| `actionlint.yml` | PRs touching `.github/**` or shell scripts | actionlint + shellcheck |

Toolchain versions come from `toolchain.json` through `.github/actions/setup-toolchains`.
