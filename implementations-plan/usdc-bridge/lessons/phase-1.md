# Phase 1 — repo scaffold + keyless testnet probe + proof spike

Status: **green 2026-09-26.**

## Gate evidence

`bun install --frozen-lockfile && bun run lint && bun run typecheck && bun run lint:actions && bun run probe:testnet && bun run spike:proof-compat` → exit 0.

- Probe: all 18 checks passed. Node 5.0.0, L1 chain 11155111, rollup version 1821665230; registry → rollup → inbox/outbox/version match node info; USDC 6 dp / EIP-712 version "2"; Permit2 code 9152 bytes; faucet mint 1000 FJ vs budget 123.18 FJ.
- Spike: an ephemeral account was deployed with real client proofs (ClientIVC ≈ 4.7 s), paid by a same-tx Fee Juice claim. Mined in block 97070, fee ≈ 1.46 FJ, 3.6 min end to end. An earlier standalone run was mined in block 97063 (fee ≈ 1.49 FJ, 3.8 min).
  → **Inference 1 holds:** the testnet 5.0.0 node accepts 5.2.0 client proofs. The fallback rule was not needed.

## Attempts and findings

1. **Sponsor drained → D24.** The canonical SponsoredFPC held 1.20 FJ.
   - Sampled testnet tx fees: p50 1.69 FJ, p90 2.02, max 4.63. Fee per L2 gas ≈ 2.02e12 (worst predicted 2.29e12); DA fee 0.
   - So the sponsor could not cover even one deploy. Inference 2 was refuted.
   - The user chose D24 (2026-09-26): the throwaway L1 key mints FEE from the permissionless `FeeAssetHandler` (1000 FEE/mint) and bridges it via `FeeJuicePortal`. Before the private smoke legs, ≥ 100 FJ is bridged to the SponsoredFPC.
2. **Budget bound.** The first budget multiplied the per-tx *gas limits* by the worst fee (≈ 540 FJ), which is uselessly conservative. It now uses estimated gas per tx (20k DA / 1.5M L2) × 12 txs × worst predicted fee × 3 headroom ≈ 117–124 FJ. The faucet gate compares that to one mint.
3. **Fee Juice bridge path (aztec.js 5.2.0).**
   - `L1FeeJuicePortalManager.bridgeTokensPublic(to, undefined, true)` mints from the handler, approves and deposits.
   - `waitForL1ToL2MessageReady` gates the claim.
   - `FeeJuicePaymentMethodWithClaim(account, claim)` pays for the account's own deploy.
   - `createExtendedL1Client` needs `createEthereumChain(rpcUrls, chainId)` and the raw private-key string (the aztec viem fork's typing rejects a canonical-viem account).
4. **API gotchas (5.2.0):**
   - `AztecAddress.fromStringUnsafe`, not `fromString`.
   - `DeployMethod.send()` resolves to `{ receipt }`, with no `txHash` on the result.
   - `node.getBlocks(from, limit)` caps `limit` at 50.
5. **forge-std from npm is not official.** The npm `forge-std` package is a third-party repackage. `contracts/evm` pins `github:foundry-rs/forge-std#bf647bd…` (v1.16.2), the commit V2's halmos suites were validated against.
6. **Worktree-isolation guard.** It refuses compound shell commands, `cd` into other dirs, variable-driven paths, and tmux launched from a wrapper script (the server dies with the wrapper). What works: the Write tool for files, single plain commands, and `tmux new-session -d -s <name> "<inline command>"` from the worktree root.
7. **Lint drift.** The first gate run failed only on biome formatting in `spike.ts`/`fee-juice.ts` (fixed with `biome check --write`). `sort-package-json` now also covers `contracts/*/package.json`.

## Carry-forward

- Phase 7 must re-run the faucet gate and bridge ≥ 100 FJ to the SponsoredFPC before the private legs.
- The L1 key (`0xFcc2…F6F5`) still needs ≥ 5 Circle Sepolia USDC before Phase 7 (a user action).
