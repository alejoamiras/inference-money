# inference-money

A USDC-only bridge between Ethereum (L1) and Aztec (L2), so users can hold USDC privately on Aztec and pay for private inference (x402).

## Layout

| Path | What |
|---|---|
| `contracts/evm` | Foundry: `TokenPortal` (L1 escrow, Aztec messaging) and `Permit2DepositRouter` |
| `contracts/aztec` | Aztec.nr: `token_bridge`, `token_minter_proxy`, `claim_secret`, `keystone` (cross-toolchain vectors) |
| `packages/bridge-core` | Framework-agnostic protocol logic: hashes, secrets, Permit2 typed data, deposit/claim/exit/withdraw, the manifest schema |
| `packages/local-network` | Per-run anvil + Aztec 5.0.0 local network: registry-claimed ports, owned process groups |
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

# RUN_ID (default "default") names the run; concurrent runs in any checkouts never share ports, processes or state
RUN_ID=a bun run net:up        # anvil + aztec 5.0.0 local network, detached; net:status / net:down
RUN_ID=a bun run deploy:local  # deploy, verify every read-back, then write deployments/local/<run>/manifest.json
RUN_ID=a bun run verify:local  # re-verify the manifest against a fresh forge build --force

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

- **One source of truth for versions:** `toolchain.json` (Aztec node/JS/Noir, nargo, Foundry, halmos, solc, Bun). `@aztec/*` npm packages are pinned exactly to `aztecJs`, except `contracts/aztec/toolchain` (the Noir scripts' aztec CLI, bb and TXE), pinned to `noir`. Never bump one without the others it couples to.
- **Secrets:** testnet keys live only in `.env.testnet` (git-ignored, mode 0600), are read in-process, and are never printed, logged, passed on argv, or written anywhere else, except that Aztec wallet/PXE stores (LMDB temp files even when "ephemeral") must run inside `withOwnedTmpDir` (deployer). No agent generates operational keys.
- **Complexity budgets:** cognitive complexity ≤ 15 everywhere; ≤ 80 non-blank lines per production function. Never suppress complexity rules in new code.
- **Comments** say what the code can't (invariants, external gotchas, non-obvious whys); never narrate, never reference plans or reviews.
- **Solidity deps come from npm** (`@openzeppelin/contracts`, `@aztec/l1-artifacts`) and forge-std from a pinned GitHub commit (the npm `forge-std` is an unofficial repackage). `foundry.toml` remaps through `contracts/evm/node_modules` with relative targets so bytecode metadata reproduces across machines. Foundry and halmos move together: a newer Foundry breaks halmos 0.3.3.
- **Formal canaries:** every halmos `check_` delegates to a public `prove*` body, and a forge canary runs that body against a one-rule-deleted mutant (`test/mocks/Mutants.sol`) and requires it to fail on that rule's assertion (`ProofCanary`). A new proof needs its mutant, its canary, and its (contract, name) pair in `scripts/halmos-gate.sh`.
- **Noir artifacts are committed and must equal their source:** rebuild only through `contracts/aztec/scripts/compile.sh` (a bare `nargo compile` writes an untranspiled artifact), and run `compile.sh --check` before committing a `.nr` change. A new Noir git dependency, direct or transitive, goes into `noir-deps.sh`'s pinned table or CI's `--exact` step fails.
- **TXE manifests:** every new Noir test gets its name in the crate's `txe-manifest.txt`; `run-txe-tests.sh` fails on a listed test that did not pass or a count under the crate's floor.
- **One viem:** bridge-core and web read L1 through canonical `viem`; `@aztec/ethereum` is banned there (biome `noRestrictedImports`).
- **Run isolation:** local networks claim ports from `~/.agents/ports.md`, spawn detached, and tear down only the process groups they own (leader pid and start time must both match); data dirs live on real disk under `~/.cache/inference-money/`. Deploys build forge output into a per-run dir, never the shared `contracts/evm/out`.
- **Mixed versions (JS 5.2.0 on a 5.0.0 node):** the canonical SponsoredFPC is a 5.0.0 class that reads the 5.0.0 HandshakeRegistry, which aztec.js 5.2.0 does not preload. A wallet that should pay through it registers that registry and passes `authorizeLegacyHandshakeReads` as its PXE `authorizeUtilityCall` hook (bridge-core `compat.ts`). A 5.0.0 local network also lacks the 5.0.1 standard contracts testnet has published; the deploy publishes them.
