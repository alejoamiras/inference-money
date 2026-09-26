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
bun run probe:testnet # keyless: pins, L1 wiring, assets, fee faucet budget

bun run test:evm        # forge fmt --check, forge lint src, unit + fuzz + invariant (hermetic)
bun run test:evm:formal # halmos, strict: exact proof names and counts (scripts/halmos-gate.sh)
bun run test:evm:gas    # .gas-snapshot --check --tolerance 2
SEPOLIA_RPC_URL=… bun run test:evm:fork  # real Permit2, Circle USDC, Aztec registry + Inbox; refuses to run unset

bun run test:noir                                     # TXE suites (token_bridge, keystone), manifest-gated
bash contracts/aztec/scripts/noir-deps.sh             # fetch + verify the pinned Noir git deps (--self-test)
bash contracts/aztec/scripts/compile.sh [--check]     # rebuild artifacts; --check: committed == source (class id + ABI)
bash contracts/aztec/scripts/check-sole-consumer.sh   # recipient-commitment static guard (--self-test)
```

## Rules

- **One source of truth for versions:** `toolchain.json` (Aztec node/JS/Noir, Foundry, halmos, solc, Bun). `@aztec/*` npm packages are pinned exactly to `aztecJs`. Never bump one without the others it couples to.
- **Secrets:** testnet keys live only in `.env.testnet` (git-ignored, mode 0600), are read in-process, and are never printed, logged, passed on argv, or written anywhere else. No agent generates operational keys.
- **Complexity budgets:** cognitive complexity ≤ 15 everywhere; ≤ 80 non-blank lines per production function. Never suppress complexity rules in new code.
- **Comments** say what the code can't (invariants, external gotchas, non-obvious whys); never narrate, never reference plans or reviews.
- **Solidity deps come from npm** (`@openzeppelin/contracts`, `@aztec/l1-artifacts`) and forge-std from a pinned GitHub commit (the npm `forge-std` is an unofficial repackage). `foundry.toml` remaps through `contracts/evm/node_modules` with relative targets so bytecode metadata reproduces across machines. Foundry and halmos move together: a newer Foundry breaks halmos 0.3.3.
- **Formal canaries:** every halmos proof has a forge canary running its body against a one-rule-deleted mutant (`test/mocks/Mutants.sol`). A new proof needs its mutant, and its name in `scripts/halmos-gate.sh`.
- **Noir artifacts are committed and must equal their source:** rebuild only through `contracts/aztec/scripts/compile.sh` (a bare `nargo compile` writes an untranspiled artifact), and run `compile.sh --check` before committing a `.nr` change. A new Noir git dependency, direct or transitive, goes into `noir-deps.sh`'s pinned table or CI's `--exact` step fails.
- **TXE manifests:** every new Noir test gets its name in the crate's `txe-manifest.txt`; `run-txe-tests.sh` fails on a listed test that did not pass or a count under the crate's floor.
- **One viem:** bridge-core and web read L1 through canonical `viem`; `@aztec/ethereum` is banned there (biome `noRestrictedImports`).
- **Run isolation:** local networks claim ports from `~/.agents/ports.md`, spawn detached, and tear down only the process groups they own; data dirs live on real disk under `~/.cache/inference-money/`.
