# Phase 1 — verbatim fork baseline

Status: **green 2026-09-30.**

## Gate evidence

Every P1 gate command exited 0:

- three `bun install --frozen-lockfile` (root, `contracts/aztec/toolchain`, `packages/local-network/toolchain`), with the Aztec release-age exclusion lists gone;
- `noir-deps.sh --self-test`, fetch and `--verify` (7 pinned entries, unchanged: aztec-standards `cdfba943` was already in the table);
- `compile.sh --check`: token `0x24c34002…1505`, proxy `0x18d06d3b…af94`, bridge `0x2e9ade2e…96a3`;
- `bun run test:noir`: `merchant_token` 84 tests passed and its manifest satisfied (83 names); `token_bridge_contract` 48; `keystone` 8;
- `bun run --cwd contracts/aztec test`: 6 pass (the identity test plus five `abi-superset.test.ts` cases);
- `bun run lint` and `bun run typecheck`.

## What was built

- `contracts/aztec/token/`: aztec-standards `src/token_contract` at `cdfba943`, copied byte for byte (`d192cb7`), then renamed to `merchant_token` with its path deps turned into git deps at the same tag (`59e687e`). The test utils deploy `@merchant_token/Token`.
- `run-txe-tests.sh --crate token` stages upstream's published `GenericProxy` and test `AuthorizationContract` artifacts, the two the suite deploys.
- `abi-superset.test.ts`: upstream functions unchanged, the additions exactly the listed ones (empty at P1), storage and events likewise, and the class id equal to npm's.

## Findings

1. **I1 holds exactly.** The fork's class id is npm's (`0x24c34002788720c941a327a20c369b12c8bdcff3b5a974673a8f618763471505`), not merely "metadata-only different". The rename to `merchant_token` and the git deps change neither bytecode nor the artifact hash. From P2 the class-id case gives way to the bytecode-size bound.
2. **Upstream has 84 tests but 83 names.** `mint_to_private_failure_total_supply_overflow` exists in both `mint_to_private.nr` and `mint_to_commitment.nr`. The manifest counts unique names, so the floor is 83; nargo's exit code still fails the run if either copy fails.
3. **The pinned nargo was missing on this host.** `toolchain.sh` defaults to `~/.aztec/versions/<noir>/bin/aztec-nargo`. Fetched the noir `v1.0.0-rc.3` release asset, checked it against `.github/actions/setup-toolchains/nargo-1.0.0-rc.3.sha256`, and ran every Noir script with `NARGO=~/.cache/inference-money/nargo-1.0.0-rc.3/nargo`.
4. **`aztec compile` warns "Tests should be in a dedicated test crate" (docs.aztec.network/errors/1)** for the token as for the bridge. It is a notice, not a failure, and the bridge carries it since the usdc-bridge plan.
5. **`artifact-identity.test.ts` needed no token case.** It tests the identity function itself; `compile.sh --check` applies it to the token artifact, and `abi-superset.test.ts` covers the token's ABI against upstream.
