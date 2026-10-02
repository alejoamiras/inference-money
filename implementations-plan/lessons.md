# Lessons

Gotchas that cost a past run and would bite other work, one line each with its archived detail; nothing repeats `AGENTS.md`.

## Aztec / Noir

- Deploy owner-initialized contracts deployer-bound, never `universalDeploy`: with a zero deployer, whoever initializes first takes the owner. [phase-6](archive/usdc-bridge/lessons/phase-6.md)
- Only finality settles a tx: keep a claim secret until its nullifier is `finalized`; a tx is gone once a finalized block passes its expiry, or at once if `sendTx` threw `Invalid tx: …` (refused before the pool), never on one node's DROPPED. The wallet-sdk strips `waitForStatus` from `wait` (6.0.0-rc.1): send `NO_WAIT`, wait on the node. [phase-11](archive/usdc-bridge/lessons/phase-11.md), [phase-13](archive/galactica-compliant-usdc/lessons/phase-13.md), [phase-15](archive/galactica-compliant-usdc/lessons/phase-15.md)
- aztec-standards Token's private mint and burn enqueue public supply `Transfer` events with the amount (still at v6.0.0-rc.1): private bridging hides who, not how much. [plan](archive/usdc-bridge/plan.md)
- The Inbox range-checks a message's actor and hashes, never the fields hashed into them, and an ABI-decoded `EthAddress` holds any field: check each hashed value where the message is emitted. [phase-15](archive/galactica-compliant-usdc/lessons/phase-15.md)
- The local network makes blocks only on txs (L1→L2 messages stall without a ~3 s heartbeat tx) and skips real-proof verification (5.0.0): proof acceptance is proven only on testnet. [phase-6](archive/usdc-bridge/lessons/phase-6.md)
- Local L2 blocks push the next L1 timestamp ~72 s ahead (5.0.0), so `evm_increaseTime` never passes a deadline: set `evm_setNextBlockTimestamp` from the head. [phase-10](archive/usdc-bridge/lessons/phase-10.md)
- 6.0.0-rc.1: claimable means `getL1ToL2MessageMembershipWitness("latest", …)` resolves (`getL1ToL2MessageIndex` answers at L1 ingestion, too early); account deploys skip instance publication, so check `initializationStatus`, not `node.getContract`. [phase-11](archive/usdc-bridge/lessons/phase-11.md)
- On a toolchain bump `compile.sh --check` diffs against HEAD's old artifacts, which the new stdlib cannot parse: commit the rebuild, then check. [phase-11](archive/usdc-bridge/lessons/phase-11.md)
- A missing authwit fails as `Unknown auth witness for message hash` in private (an oracle error) but `unauthorized` in public (v5, v6 rc.1). [phase-3](archive/usdc-bridge/lessons/phase-3.md)
- Test field elements must be below the BN254 modulus (`0xabab…` is not); aztec.js retries a node 503, so a fault must fail every call. [phase-9](archive/usdc-bridge/lessons/phase-9.md), [phase-10](archive/usdc-bridge/lessons/phase-10.md)

## Foundry / halmos

- `forge snapshot --root contracts/evm` writes `.gas-snapshot` to the cwd: regenerate from inside `contracts/evm`. [phase-2](archive/usdc-bridge/lessons/phase-2.md)

## Bun / TypeScript / tests

- bun reads `bunfig.toml` from the cwd only: a nested standalone project misses the root's age gate and linker, and `bun run --cwd` its preload. [phase-3](archive/usdc-bridge/lessons/phase-3.md), [phase-10](archive/usdc-bridge/lessons/phase-10.md)
- A skipped optional package stays skipped after joining `minimumReleaseAgeExcludes` while `bun.lock` holds its parent (symptom: `aztec-wsdb binary not found`): drop the parent's entry to re-resolve. [phase-11](archive/usdc-bridge/lessons/phase-11.md)
- bun blocks lifecycle scripts; the Aztec node needs `trustedDependencies: ["bcrypto"]` (discv5 loads its native build). [phase-10](archive/usdc-bridge/lessons/phase-10.md)
- Pin `@types/node` to bun-types' version; another becomes the isolated linker's hoisted fallback and breaks typecheck. [phase-8](archive/usdc-bridge/lessons/phase-8.md)
- `Bun.spawn` (1.4.0) ignores `process.env` deletions: spawn a child that must not inherit a secret through `node:child_process` or `Bun.$`. [phase-8](archive/galactica-compliant-usdc/lessons/phase-8.md)
- A closure's inner functions count toward its function's 80-line budget; use a class with private methods. [phase-9](archive/usdc-bridge/lessons/phase-9.md)
- Assert the failure reason: a spec passing on "not deployed" instead of the deployer check, self-test fixtures sharing one dir, and `fail_on_revert = false` invariants can all pass vacuously. [phase-3](archive/usdc-bridge/lessons/phase-3.md), [phase-6](archive/usdc-bridge/lessons/phase-6.md)

## viem / L1

- viem caches `getBlockNumber` ~4 s per client, so a tip read after a receipt can predate the tx: use `cacheTime: 0`, scan through `max(tip, finalized)`. [phase-6](archive/usdc-bridge/lessons/phase-6.md)
- viem's receipt wait follows replacements, cancellations too: check the expected event (Outbox `MessageConsumed`) in the receipt. One `TransactionNotFound` from a load-balanced RPC is not a drop. [phase-7](archive/usdc-bridge/lessons/phase-7.md), [phase-10](archive/usdc-bridge/lessons/phase-10.md)
- A test key anvil doesn't hold must sign locally, or viem sends `eth_signTypedData_v4` to anvil ("No Signer available"). [phase-6](archive/usdc-bridge/lessons/phase-6.md)

## Browser e2e

- bb.js loads its wasm from a `data:` URL and real proving fetches the CRS from `crs.aztec-cdn.foundation` or `crs.aztec-labs.com`: CSP `connect-src` needs `data: blob:` and both. [phase-8](archive/usdc-bridge/lessons/phase-8.md), [phase-10](archive/galactica-compliant-usdc/lessons/phase-10.md)
- Playwright runs under Node: Bun-only packages (`import.meta.dir`) live in a Bun sidecar the specs call over HTTP. [phase-8](archive/usdc-bridge/lessons/phase-8.md)
- A local network can finish a flow between Playwright polls: assert durable state, not a transient step. [phase-10](archive/usdc-bridge/lessons/phase-10.md)

## CI

- Reproduce CI with `CI=true GITHUB_ACTIONS=true` (logs gain ANSI codes that broke a `$`-anchored grep; spawn with `FORCE_COLOR=0`) and ubuntu-24.04's shellcheck 0.9.0, which predates SC2329 (disable `SC2317,SC2329`). [phase-10](archive/usdc-bridge/lessons/phase-10.md)
- Never run the Aztec installer in CI: it runs noirup from `main`, foundryup via `curl | bash` and an unlocked npm install. [phase-3](archive/usdc-bridge/lessons/phase-3.md)
- Path filters must list every shared root file a suite loads (`test-preload.ts` was missing from three). [phase-10](archive/usdc-bridge/lessons/phase-10.md)

## Testnet ops

- Sepolia's canonical Aztec rollup switched on 2026-09-28 while the docs stayed put, and `TokenPortal.initialize` binds the canonical one: `probe:testnet` before any spend. [phase-7](archive/usdc-bridge/lessons/phase-7.md)
- The public SponsoredFPC can run near empty: top it up from the `FeeAssetHandler` faucet via `FeeJuicePortal` before sponsored legs. [phase-1](archive/usdc-bridge/lessons/phase-1.md)
- Secrets leak through error text: viem HTTP errors embed the RPC URL, `Fr.fromHexString` echoes its input, pino and native writes bypass `console`: only a redacting pipe around a child catches all. [phase-7](archive/usdc-bridge/lessons/phase-7.md)

## Harness / host

- The worktree guard refuses what it cannot prove stays in the worktree (git pipelines or loops, `git` inside a path or heredoc, variable-built paths, `cd` elsewhere): run a written script or plain commands; start tmux as `tmux new-session -d -s <name> "<cmd>"`. [phase-1](archive/usdc-bridge/lessons/phase-1.md)
- `~/.agents/ports.md` keeps the host's table and O_EXCL `ports.md.lock`, shared with other tools: no my-stack template, `mkdir` lock or `flock`; never break a lock whose named holder died. [phase-5](archive/usdc-bridge/lessons/phase-5.md), [phase-7](archive/usdc-bridge/lessons/phase-7.md)
- The Aztec node's Unix sockets live in its TMPDIR: past 107 bytes (a long run id) the bind fails silently and the node never answers. [phase-10](archive/galactica-compliant-usdc/lessons/phase-10.md)
- Homelab: git signs tags (fixtures need `git tag -m`), perl warns under the host locale (use `LC_ALL=C`), and `~/nargo` is shared, so `noir-deps.sh --exact` passes only on CI's clean cache. [phase-3](archive/usdc-bridge/lessons/phase-3.md)
