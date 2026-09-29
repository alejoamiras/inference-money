# Phase 2 — L1 contracts + V2 QA Solidity port

Status: **green 2026-09-26.**

## Gate evidence

`bun run test:evm && bun run test:evm:formal && bun run test:evm:gas && SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com bun run test:evm:fork` → exit 0.

- **`test:evm`**: remapping check, `forge fmt --check`, `forge lint src -D warnings`, then 64 hermetic tests in 13 suites. Invariants run at runs=256, depth=500 (~128k handler calls per suite, 0 handler reverts).
- **`test:evm:formal`**: the strict gate saw exactly 3 `FormalPortalTest` + 5 `FormalRouterTest` proofs, all passing. `check_deposit_conservesUserFunds` explores 480 paths in ~22 s.
- **`test:evm:gas`**: `.gas-snapshot` check at tolerance 2.
- **`test:evm:fork`**: 8/8 passed, 0 skipped, against real Sepolia Permit2, Circle USDC, the Aztec testnet registry and Inbox.

## What was built

- **`TokenPortal.sol`**: V1 portal + F-001 + [D19].
  - `AmountExceedsL2Max`; `InexactTransfer` on the deposit pull *and* the withdraw payout (a portal-debit check); `nonReentrant` via `ReentrancyGuardTransient`.
  - The Apache-2.0 header carries provenance and a modification notice (§4(b)).
  - The content-hash code is canonical, pinned by the unchanged V1 `ContentHash.t.sol` literals.
- **`Permit2DepositRouter.sol`**: per plan, plus two extra errors.
  - `NotAContract`: the constructor refuses a codeless Permit2 or portal.
  - `ResidualBalance`: the router's balance must be unchanged after each call. With the guarded portal this is redundant defense, but it makes the plan's "router balance change per call is exactly 0" rule explicit on chain.
- **Virtual guard hooks** so every proof gets a one-rule-deleted mutant canary (V2's `PortalImplWithoutPause` pattern):
  - portal: `_requireInitializable`, `_requireDeposit`;
  - router: `_checkIntent`, `_checkSettled`.
  - Semantics are unchanged; via-IR inlines them.
- **Tests.** The full V2 QA Solidity list, plus:
  - `check_initialize_rejectsNonInitializer`, a proof beyond the plan's list that covers the other half of F-001;
  - a withdraw-to-portal-itself test, pinning the L1 half of `exitToL1`'s recipient rule;
  - a stolen-signature fork test (threat (a) in the plan).

## Decisions and deviations

1. **`gen-remappings.ts` became `check-remappings.ts`.**
   - Under Bun's isolated linker, `contracts/evm/node_modules/<pkg>` are per-package symlinks. So static *relative* remappings resolve on any machine, and solc reads through them once `allow_paths` includes the repo-root store.
   - Relative targets keep source unit names machine-independent (`node_modules/@aztec/...`), so the CBOR metadata hash, and with it the runtime bytecode `deployer verify` compares, reproduces anywhere. Generating absolute realpaths would not.
   - The script asserts that every target exists and that forge's effective remappings equal the declared set. `auto_detect_remappings = false`, because otherwise forge pulls l1-artifacts' own `lib/` remappings in.
2. **`@aztec-blob-lib/` is required.** `IRollup` → `FeeLib`/`ProposeLib` import it.
3. **`evm_version = cancun`.** `ReentrancyGuardTransient` needs `TSTORE`. Sepolia is post-Pectra, so cancun bytecode runs there.
4. **One fork file, `SepoliaFork.t.sol`.** The registry is pinned as a constant (the same pin the probe checks) rather than read from an `AZTEC_REGISTRY` env var. `fork-gate.sh` refuses to run without `SEPOLIA_RPC_URL`, so "no fork test skipped when the RPC is set" holds by construction.
5. **Forge lint.** `src/` is gated with `-D warnings`. `test/**` is ignored: tests cast revert data to selectors and mask fuzz deltas on purpose. The two unchecked-transfer findings in the mocks were fixed anyway (SafeERC20).
6. **CI halmos install.** It uses `pipx` instead of `pip install --user`: GitHub's Ubuntu 24.04 system Python is externally managed (PEP 668). This fixed a latent bug in the Phase 1 setup action.
7. **Witness/digest literals.** They were computed independently with `cast` (scratch script), then pinned in `WitnessHash.t.sol`. The Solidity derivation matched on the first run, and the fork test proves the domain derivation equals live Permit2's `DOMAIN_SEPARATOR()`.

## Attempts / incidents

- **First build failed.** `@aztec-blob-lib` was missing, and auto-detected remappings leaked from l1-artifacts' `lib/`. Fixed as in (1)/(2).
- **One-off halmos `[ERROR]`.** On the very first run, `check_deposit_rejectsAmountAboveU128` (FormalPortal) reported ERROR. It did not reproduce in 5 subsequent runs, including one from a forced rebuild, alone and together with the other suites. The strict gate treats ERROR as failure, so a recurrence cannot pass silently. If it recurs, capture `-vv` output before retrying.
- **`forge snapshot --root contracts/evm`** writes `.gas-snapshot` to the *cwd*, not the root. Regenerate from inside `contracts/evm`.
