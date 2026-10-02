# Phase 4 — L1 portal and router

Status: **green 2026-10-01.**

## Gate evidence

- `forge snapshot` regenerated from inside `contracts/evm`: router deposits cost about 4.9k gas more (private 589362 → 594274, public 590518 → 595850), from the router check's storage read, the extra calldata word and hash input, and the indexed depositor topic.
- `bun run test:evm`: `forge fmt --check`, `forge lint src -D warnings`, 70 tests across 13 suites (unit, fuzz, invariant, canaries).
- `bun run test:evm:formal`: the gate's self-test, then exactly the 10 expected (contract, proof) pairs. The new proofs are `check_depositFor_rejectsNonRouter` (3 paths) and `check_deposit_namesItsCallerAsDepositor` (22 paths, over a symbolic caller). Each new canary fails its proof against `PortalWithoutRouterCheck` or `RouterNamesItself`.
- `bun run test:evm:gas` (tolerance 2), and `bun run test:evm:fork` against the public Sepolia RPC: 8 of 8, deployed in the new order (portal → router → `initialize(…, router)`).
- `ContentHash.t.sol` reproduces the plan's three literals in Solidity, the same values the viem recomputation gave during planning.
- `bun run lint`.

## Findings

1. **The fork suite's Sepolia pins were stale since the 2026-09-28 rollup switch.** The deployer was re-pinned to rollup `2914217885` (Inbox `0x816c…1E30`, Outbox `0xb9da…DF0d`), but `SepoliaFork.t.sol` kept the v5 rollup's. Nothing tied the two together, and the gate had not run the fork suite since. Fixed: re-pinned, and `packages/deployer/src/networks.test.ts` now asserts the suite's registry, Inbox, Outbox, rollup version, USDC and Permit2 equal `TESTNET`.
2. **The v6 Inbox's `MessageSent` changed shape**: one indexed topic (the leaf), with the whole `L1ToL2Msg` in the data. The old decoder read `topics[2]` and panicked. The fork test now decodes the message and checks sender, recipient, index, secret hash, and that the content names the signer. That makes it the only test where the real Inbox's message carries the depositor.
3. **Halmos drops paths that revert, so a proof whose body only asserts on success can pass vacuously.** The naming proof's canary therefore runs the body against the real router once (success reachable) before the mutant (assertion trips). Confidence moderate that halmos 0.3.3 ignores reverting paths; the canary costs one forge call either way.
4. **`vm.expectRevert` binds to the next call, and a `new` in the argument list is that call.** The first run of the router-mismatch test failed with "next call did not revert": the stub router's creation consumed the expectation. Create fixtures before the expectation.
5. **Forge 1.7.1 prints `error[2353]`** (an invalid contract in an override list) for the upstream `l1-artifacts` `governance/GSEPayload.sol` whenever a build compiles it. solc compiles the file, the build succeeds, and nothing gates on it; it is upstream noise.
6. Between P4 and P5, `deploy:local` and the integration suite are expected to fail. The deployer still calls the three-argument `initialize` and the two-argument router constructor, and P5 adapts it. This is the arc-level atomicity the plan accepts.
