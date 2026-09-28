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
| `packages/integration` | bridge-core flows end to end against a per-run local network with the bridge deployed |
| `apps/web` | The React app: wagmi L1, the Aztec wallet-sdk session, a build-embedded manifest; `e2e/` holds the browser harness |
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
bun run test:integration      # own network + deploy (or NET_L1_RPC + NET_NODE_URL to attach), every spec, teardown
bash packages/local-network/scripts/install-node.sh <dir>  # CI's node: frozen lock + sha-pinned Foundry; AZTEC_NODE_HOME=<dir> selects it

bun run --cwd apps/web test:components           # vitest: session store, grant, build target, test-wallet guard
BRIDGE_MANIFEST=<file> bun run --cwd apps/web build   # any deployed manifest; build:testnet pins deployments/testnet.json
bun run test:e2e [-- connect.spec.ts]             # own network + deploy + app/wallet builds + sidecar + Playwright, then reap

bun run deploy:testnet   # probe the pins, deploy with real proofs + self-funded Fee Juice, verify, write deployments/testnet.json
bun run verify:testnet   # re-verify deployments/testnet.json against the live chains and a fresh forge build
bun run smoke:testnet    # four 1-USDC legs with real proofs; exit tickets kept in ~/.cache/inference-money/smoke to resume
bun run secrets:scan     # yes/no only: any .env.testnet value outside it, any wallet store left on disk

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
- **Secrets:** testnet keys live only in `.env.testnet` (git-ignored, mode 0600), are read in-process, and are never printed, logged, passed on argv, or written anywhere else (every non-local deployer command runs as a child whose output is redacted line by line), except that Aztec wallet/PXE stores (LMDB temp files even when "ephemeral") must run inside `withOwnedTmpDir` (deployer). No agent generates operational keys.
- **Complexity budgets:** cognitive complexity ≤ 15 everywhere; ≤ 80 non-blank lines per production function. Never suppress complexity rules in new code.
- **Comments** say what the code can't (invariants, external gotchas, non-obvious whys); never narrate, never reference plans or reviews.
- **Solidity deps come from npm** (`@openzeppelin/contracts`, `@aztec/l1-artifacts`) and forge-std from a pinned GitHub commit (the npm `forge-std` is an unofficial repackage). `foundry.toml` remaps through `contracts/evm/node_modules` with relative targets so bytecode metadata reproduces across machines. Foundry and halmos move together: a newer Foundry breaks halmos 0.3.3.
- **Formal canaries:** every halmos `check_` delegates to a public `prove*` body, and a forge canary runs that body against a one-rule-deleted mutant (`test/mocks/Mutants.sol`) and requires it to fail on that rule's assertion (`ProofCanary`). A new proof needs its mutant, its canary, and its (contract, name) pair in `scripts/halmos-gate.sh`.
- **Noir artifacts are committed and must equal their source:** rebuild only through `contracts/aztec/scripts/compile.sh` (a bare `nargo compile` writes an untranspiled artifact and skips the pinned-dependency check compile.sh runs first), and run `compile.sh --check` before committing a `.nr` change. A new Noir git dependency, direct or transitive, goes into `noir-deps.sh`'s pinned table or CI's `--exact` step fails.
- **TXE manifests:** every new Noir test gets its name in the crate's `txe-manifest.txt`; `run-txe-tests.sh` fails on a listed test that did not pass or a count under the crate's floor.
- **One network per bundle:** a web build embeds exactly one manifest at build time and has no runtime override; iframe wallet URLs (`WEB_WALLET_URLS`) are accepted only for a `local` manifest, and `build:testnet` refuses every override.
- **The e2e test wallet enforces its grant:** every call outside what the app requested is refused, as a real wallet does. A new wallet call in the app needs its scope in `src/wallet/capabilities.ts`, or the suite fails.
- **bun test and `@aztec/*`:** a cold `bun test` injects its `expect` into `@aztec/foundation`, which then calls Jest's `expect.addEqualityTesters`; every bun test script that loads `@aztec/*` passes `--preload ../../test-preload.ts`. A warm transpiler cache hides a missing preload locally (`BUN_RUNTIME_TRANSPILER_CACHE_PATH=0` reproduces CI).
- **bb.js does not run under jsdom** (its msgpack rejects jsdom's cross-realm typed arrays): web tests that hash through real bridge-core use `// @vitest-environment node`; jsdom component tests fake the draft and send (`offlineDepositOps` in `src/bridge/test/fake-env.ts`).
- **One viem:** bridge-core and web read L1 through canonical `viem`; `@aztec/ethereum` is banned there (biome `noRestrictedImports`).
- **Run isolation:** local networks claim ports from `~/.agents/ports.md`, spawn detached, and tear down only the process groups they prove they own (leader pid and start time, or once the leader exits a member carrying the group's `INFERENCE_MONEY_OWNER` marker; unprovable means untouched); data dirs live on real disk under `~/.cache/inference-money/`. Deploys build forge output into a per-run dir, never the shared `contracts/evm/out`.
- **Mixed versions (JS 5.2.0 on a 5.0.0 node):** the canonical SponsoredFPC is a 5.0.0 class that reads the 5.0.0 HandshakeRegistry, which aztec.js 5.2.0 does not preload. A wallet that should pay through it registers that registry and passes `authorizeLegacyHandshakeReads` as its PXE `authorizeUtilityCall` hook (bridge-core `compat.ts`). A 5.0.0 local network also lacks the 5.0.1 standard contracts testnet has published; the deploy publishes them.
