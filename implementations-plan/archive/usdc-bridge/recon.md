# Recon — usdc-bridge

Phase 0.4 findings (3 read-only Sonnet explorers + driver verification, 2026-09-25). The target repo was empty (unborn `main`), so "reuse" means reuse from `alejoamiras/nulo` history, the `my-stack` conventions, and local reference repos.

## Source identities

| Name | nulo commit | What it is |
|---|---|---|
| **V1 (port base)** | `4df5eae5` (2026-09-02) | Single-token bridge: `NuloTokenPortal` + `SwapBridgeRouter` (Permit2) + `token_bridge` / `token_minter_proxy` / `claim_secret` / `keystone` + `@nulo/bridge-core` + Vue `apps/tools` |
| V2 (not ported) | `1d40d56e`..`6b07138b` (#536–#540, 2026-09-04) | Portal factory + immutable-args clones, L2 `token_bridge_hub`, any-ERC-20 wizard; "retire the single-token bridge" |
| Freeze | `14f1edd8^` = `6611f861` (2026-09-24) | Last tree before #691 deleted tools/bridge from nulo. Source of the test harness (#576/#577) and two post-V1 test-pattern fixes |
| Genesis | `54708390` (2026-06-09) | First USDC-only bridge (public deposit + withdraw, Aztec 4.2.0). Predates Permit2 and recipient commitment, so it is not the base |

License: nulo is Apache-2.0 (`LICENSE` at freeze). `alejoamiras/unleashed` (intended extraction target) is an empty repo — nothing to compare.

## Reuse map

| Capability needed | Existing code found | Verdict |
|---|---|---|
| L1 portal (deposit public/private, withdraw) | `contracts/bridge/evm/upstream/NuloTokenPortal.sol` @V1 — canonical Aztec `TokenPortal` + F-001 init-once/deployer-only guard, byte-identical elsewhere | **reuse-as-is** (compile in-project against `@aztec/l1-artifacts` sources, freeze `foundry.toml` pattern) |
| Permit2 deposit entry | `SwapBridgeRouter.bridge()` @V1 (fuel-less path already exists) | **adapt**: delete fuel/swap; bind portal+token as immutables (closes A-1); shrink 12-field witness to the fields `bridge()` uses (typehash changes → re-pin vectors) |
| L2 bridge | `token_bridge` @V1 (claim_public/private, exit_to_l1_public/private, 2-step owner, pause) | **reuse-as-is** |
| L2 mint authority | `token_minter_proxy` @V1 (F-002: single set-once bridge, no owner mint) | **reuse-as-is** (competing outline B drops it) |
| Recipient-committed private claim | `claim_secret` lib + `keystone` cross-toolchain vectors @V1 (unchanged through freeze) | **reuse-as-is** |
| Static invariant guard | `scripts/check-sole-consumer.sh` (+ `--self-test`) @V1 | **reuse-as-is** |
| TXE test runner | `scripts/run-txe-tests.sh` + `token_bridge/src/test/*.nr` (640 LOC) @V1 | **reuse-as-is** |
| Noir compile | `scripts/compile.sh` (pinned `~/.aztec/versions/5.0.1`, path-scrubbed artifacts) | **reuse-as-is** |
| L1 contract tests | V1: `ContentHash.t.sol`, `PortalReinit.t.sol`, `FormalPortal.t.sol` (halmos), `PortalRoundtripFuzz.t.sol`, `FormalRouter.t.sol`, `WitnessHash.t.sol`, `SwapBridgeRouter{,Fuzz,Invariant,Permit2Fork}.t.sol`, `BlackhatAudit.t.sol` F-A/F-B. Freeze: `CloneWithdrawRealOutbox.t.sol` (real Outbox), delta-assertion fix `bacf371f` | **adapt**: split out fuel halves; recompute witness vectors; port real-Outbox + delta patterns onto the single portal |
| Content hash (TS) | `bridge-core/src/content-hash.ts` (WebCrypto sha256, 3rd cross-pinned toolchain) | **reuse-as-is** |
| Claim secret (TS) | `bridge-core/src/claim-secret.ts` | **reuse-as-is** |
| Permit2 typed data | `bridge-core/src/l1.ts` (`BridgeWitness`, `ensurePermit2Allowance`, deadline) | **adapt** (shrunk witness; drop `PoolKey`/`hashRoute`) |
| Deposit / withdraw flows | `bridge-core/src/flows.ts` `runRouterDeposit`, `consumeWithdrawal` (journal-agnostic, stage callbacks) | **adapt** (drop `runSwapBridge`, persistence hooks) |
| L2 claim/exit primitives | `bridge-core/src/l2.ts` | **reuse-as-is** |
| Receipt resilience | `bridge-core/src/l1-receipt.ts` | **reuse-as-is** |
| Progress model | `bridge-core/src/{progress,status}.ts` | **reuse-as-is** |
| Fees | `bridge-core/src/fee-juice.ts` (`predictedWorstMinFees`, `sponsoredFeePayment`) | **adapt** (drop fjwc/fuel) |
| Deployment manifest | `bridge-core/src/candidate-schema.ts` (strict zod) + `apps/tools/src/contracts/bridge-deployments.ts` (instance reconstruction from salt+args) | **adapt** (drop fuel/feeJuice/promotion blocks) |
| Relayer helpers | `bridge-core/src/relay-claim.ts` | **build new: no** — relayer is out of scope; not ported (would be dead code) |
| Aztec wallet session | `apps/tools/src/composables/createAztecWalletSession.ts` (998 LOC; discovery → picker → emoji → capabilities → account choice → register; epoch/flow ownership) — ~95 % framework-agnostic | **adapt**: swap Vue `ref` for an external store + `useSyncExternalStore` |
| Capability manifest | `apps/tools/src/lib/capabilities.ts::buildBridgeManifest` | **adapt** (USDC-only scope) |
| Wallet errors / formatting | `apps/tools/src/lib/{wallet-errors,format}.ts` | **reuse-as-is** |
| Retry on unregistered contract | nulo #607 (`CONTRACT_NOT_REGISTERED` → re-register once, identity fence) | **adapt** into core |
| L1 wallet | `apps/tools/src/composables/useL1Wallet.ts` (raw `window.ethereum` + viem `custom()`) | **build new** with wagmi 3 + viem (user stack rule: wagmi for L1 work); keep V1's "canonical viem in app, `@aztec/viem` only in core, exchange primitives only" boundary |
| React UI | none in nulo history (Vue only). `~/Projects/shield.human.tech` (React+wagmi+wallet-sdk bridge) and `~/Projects/aztec-kit/apps/bridge` (React+Vite) exist but carry **no LICENSE** | **build new**; the two React repos are pattern references only, no code copied |
| Local network harness | freeze `packages/bridge-core/scripts/sandbox/local-network.ts` (native anvil + `aztec start --local-network`, `~/.agents/ports.md` registry, pgid teardown, real-disk datadir, version pinned from package.json) + `handle.ts` + `bytecode/permit2.json` | **adapt** (strip V2 hub `context.ts`/`flows-matrix.ts`) |
| E2E harness | freeze `apps/tools/scripts/e2e/{agent.sh,resolve-ports.ts}`, `tests/browser/{test-wallet/*,fixtures/{l1-wallet,egress,sandbox}.ts,global-setup.ts}` | **adapt** the design (embedded wallet-sdk wallet, Node-backed injected L1 signer, egress fence, one origin per wallet profile); rewrite page objects/specs for React |
| Scaffold / CI | `my-stack` SKILL.md (inline templates: bunfig min-age + isolated linker, biome budgets, husky/commitlint/lint-staged, per-package paths-filtered workflows, actionlint, Workers static-assets `wrangler.jsonc`) | **reuse** conventions |

## Versions (verified)

- Testnet node (`node_getNodeInfo`, 2026-09-25): `nodeVersion 5.0.0`, `l1ChainId 11155111`, `rollupVersion 1821665230`, outbox `0x905f…42ff`, inbox `0x3047…4f7c`.
- npm: `@aztec/aztec.js` latest `5.2.0`; `@aztec-foundation/aztec-standards` `5.0.1` … `5.2.0`; `wagmi` latest `3.7.7`.
- nulo at V1/freeze: `@aztec/*` JS **5.2.0**; Noir `aztec-nr` + `aztec-standards` **v5.0.1**; compile toolchain `~/.aztec/versions/5.0.1`; local network booted from the JS pin (5.2.0).
- Local: `~/.aztec/versions/{5.0.1,5.2.0}` installed; forge 1.7.1; bun 1.4.0; `nargo` only via `aztec-nargo` in the versions dir.
- Circle Sepolia USDC `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`: `decimals 6`, `version "2"`, EIP-2612 (`DOMAIN_SEPARATOR`, `nonces`), proxy impl `0xda31…9068`. Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3` deployed on Sepolia (codesize 9152).

## Collision / dedup risks

- `apps/tools` composables (`deposit-flow.ts` 1119 LOC, `useWithdraw.ts`) re-implement `bridge-core/flows.ts` with journal/fuel entanglement. Port **from bridge-core**, not the composables, or the app will carry a second flow implementation.
- The shrunk Permit2 witness must be pinned in three places (Solidity `WitnessHash.t.sol`, TS typed-data test, router typehash) — reusing V1 vectors verbatim would silently pass a stale test.
- `@aztec/viem` (core, Aztec's own L1 wrappers such as `OutboxContract`) vs canonical `viem` (app, wagmi): never pass client objects across that line.

## Open security findings inherited from V1

| Finding | Status at V1 | Carry-over |
|---|---|---|
| A-1 router trusts caller-supplied portal | open, "must fix before value" | **fixed by design** (immutable portal/token) |
| MED bearer signature ≠ signer intent | open | residual; mitigated by UI display + frame-ancestors, documented |
| F-003 no contract CI | deferred | **fixed** (contracts workflow) |
| Noir deps tag-pinned, no lockfile | deferred | tag→commit assertion at compile time |
| INFO-2 L1 deposits not gated by L2 pause | informational | documented |
| #554 private exit names a public fee payer | fixed post-V1 via fuel infra | **fixed differently**: private claim + private exit pay via SponsoredFPC when the network has one |

## Absence claims (search trails)

- No React bridge UI in nulo history: `git log --all --diff-filter=A -- '*.tsx'` over bridge paths + tools app is Vue SFCs only (explorer 3).
- No V1 local-network boot code: `git ls-tree -r --name-only 4df5eae5 -- packages/bridge-core/scripts` has no `sandbox/` (explorer 2); it arrives at #576.
- No contract CI in nulo: `grep -rn "forge test\|nargo test" .github/workflows/*.yml` at V1 and HEAD → none (explorer 1).
- No `Nargo.lock` / `.gitmodules`: `git ls-tree -r 4df5eae5 -- contracts/bridge/aztec | grep -i lock`, `git show 4df5eae5:.gitmodules` → none (explorer 1).
- No license in `shield.human.tech` / `aztec-kit`: `ls` for `LICENSE*`/`COPYING*` at repo root → none; `package.json` has no `license` (driver).
