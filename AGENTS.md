# inference-money

A USDC-only bridge between Ethereum (L1) and Aztec (L2), so users can hold USDC privately on Aztec and pay for private inference (x402).

## Layout

| Path | What |
|---|---|
| `contracts/evm` | Foundry: `TokenPortal` (L1 escrow, Aztec messaging) and `Permit2DepositRouter` |
| `contracts/aztec` | Aztec.nr: `token_bridge`, `token_minter_proxy`, `claim_secret`, `keystone` (cross-toolchain vectors) |
| `packages/deployer` | Network probe, deploy, verify and smoke (local + testnet) |
| `implementations-plan/` | Plans and per-phase lessons; `usdc-bridge/plan.md` is the active plan |

## Commands

```sh
bun install
bun run lint          # biome + sort-package-json + shellcheck
bun run typecheck     # tsc --noEmit per workspace
bun run test          # every workspace's unit tests
bun run lint:actions  # actionlint
bun run probe:testnet # keyless: pins, L1 wiring, assets, fee sponsor budget
```

## Rules

- **One source of truth for versions:** `toolchain.json` (Aztec node/JS/Noir, Foundry, halmos, solc, Bun). `@aztec/*` npm packages are pinned exactly to `aztecJs`. Never bump one without the others it couples to.
- **Secrets:** testnet keys live only in `.env.testnet` (git-ignored, mode 0600), are read in-process, and are never printed, logged, passed on argv, or written anywhere else. No agent generates operational keys.
- **Complexity budgets:** cognitive complexity ≤ 15 everywhere; ≤ 80 non-blank lines per production function. Never suppress complexity rules in new code.
- **Comments** say what the code can't (invariants, external gotchas, non-obvious whys); never narrate, never reference plans or reviews.
- **One viem:** bridge-core and web read L1 through canonical `viem`; `@aztec/ethereum` is banned there (biome `noRestrictedImports`).
- **Run isolation:** local networks claim ports from `~/.agents/ports.md`, spawn detached, and tear down only the process groups they own; data dirs live on real disk under `~/.cache/inference-money/`.
