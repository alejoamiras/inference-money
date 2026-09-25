---
plan: usdc-bridge
tier: mid
driver: claude-code
eli5_mode: artifact
code_review: off
harden: "/harden security scoped to contracts/ only, after all arcs and the final cross-arc pass, before PRs (user decision)"
budget: "recon 3 agents (done); /code-review off; codex at high on gpt-6-astra"
quality_bar: production-grade code (value-bearing design), deployed to local + Sepolia/Aztec testnet in this plan
source: "alejoamiras/nulo @ 4df5eae5 (V1) + test-harness patterns from 6611f861 (freeze)"
status: v5 — approved by the user 2026-09-25 (codex r5 APPROVE); implementing
---

# usdc-bridge — USDC-only L1 ↔ Aztec bridge for Galactica

## Goal

Port nulo's "V1" single-token bridge into this repo as a **USDC-only** L1 ↔ L2 bridge with a React frontend, on the `my-stack` layout. Team Galactica needs it so users can move USDC onto Aztec and pay privately (x402) for private inference.

**Done means:** a user connects an L1 wallet and an Aztec wallet in the web app. They can (1) deposit Sepolia USDC with a Permit2 signature, publicly or privately, and claim it on Aztec, and (2) exit USDC from Aztec, publicly or privately, and withdraw it on L1 once the epoch is proven. Four things prove it: integration tests against a local network running the **same node version as testnet (5.0.0)**, Playwright e2e, contracts deployed to Sepolia + Aztec testnet, and a scripted live smoke on testnet.

### In scope
- L1: canonical-fork `TokenPortal` (V1's `NuloTokenPortal`) + a new USDC-bound Permit2 router trimmed from V1's `SwapBridgeRouter.bridge()`.
- L2: `token_bridge`, `token_minter_proxy`, `claim_secret`, `keystone` (Aztec.nr v5.0.1), aztec-standards `Token` v5.0.1.
- TS core, local-network harness, deployer (local + testnet), integration suite, React app, Playwright e2e, CI.
- Recipient-committed private claims (the contract feature; the user's own wallet submits the claim).
- "Finish a withdrawal" from the L2 exit tx hash **plus the L1 recipient and amount**. The L2→L1 message only publishes `sha256(recipient, amount, caller)`, so those inputs are required. No persistence is needed.

### Out of scope
- Fee-Juice fuel / Uniswap swap, drip faucet, V2 factory/hub, journal/backup/recovery.
- A relayer service. The contracts permit one; see Deferred.
- Mainnet config/deploy. Connecting Cloudflare Workers Builds (`wrangler.jsonc` ships; the dashboard connection is the user's action).

### Accepted risks (user decisions, 2026-09-25)
1. **No persistence.**
   - **Deposit legs:** the claim secret/salt lives only in memory. If the tab closes between the L1 deposit and the L2 claim, that deposit is **unclaimable forever** and its USDC stays locked in the portal.
   - **Exit legs:** these are **not** cryptographically lost. The user can finish from the L2 tx hash plus the recipient and amount they chose (the app offers this).
   - **Mitigations inside the constraint:** a `beforeunload` guard while a deposit is unclaimed, a warning before each irreversible step, and an in-memory deposit draft created **before** signing so receipt/log/wallet failures never drop the secret mid-session.
2. **Permit2 unlimited approval.** The first deposit sets `USDC.approve(PERMIT2, max)`. From then on, **any** Permit2 signature the user is phished into (naming an attacker as spender, on any site) can drain their full USDC balance. This is the standard Permit2 posture. The UI states it plainly at the approval step.
3. **Wallet-dependent fee-payer privacy.** We request SponsoredFPC payment for private claims/exits; each wallet decides. Support is best-effort for any wallet-sdk wallet, and only the embedded test wallet is proven. The UI discloses this.
4. **A claims pause can destroy in-flight deposits** ([D20], 2026-09-25). The owner can pause claims (V1 model). During a pause, a deposit made but not yet claimed survives only while its tab stays open.
   - **Mitigations:** the app reads the bridge's `is_paused` public storage slot (slot taken from the artifact's storage layout; V1 has no getter and the contract stays verbatim) and **refuses to start a deposit while paused**. The unclaimed-deposit screen says a pause is in effect and that the tab must stay open, and the `beforeunload` guard stays armed.
   - **Residual:** deposits already in flight when the pause starts.

---

## Architecture & Implementation

### Proposed architecture

```
contracts/
  evm/                Foundry. src/{TokenPortal.sol, Permit2DepositRouter.sol, interfaces/}, test/, script/
  aztec/              token_bridge/, token_minter_proxy/, claim_secret/, keystone/, scripts/{compile,run-txe-tests,check-sole-consumer,noir-deps,nargo-5}.sh, txe-server/
packages/
  bridge-core/        protocol logic (hashes, secrets, typed data, deposit/claim/exit/withdraw flows, manifest schema). Framework-agnostic; bun:test
  local-network/      anvil + `aztec start --local-network` lifecycle (pinned node version), ~/.agents/ports.md registry
  deployer/           deploy / verify / preflight / smoke a bridge on a network (local | testnet); writes the manifest
  integration/        private, tests only: end-to-end protocol tests against a per-run local network
apps/
  web/                React 19 + Vite + TS strict + Tailwind v4 + shadcn/ui (Vitest); e2e/ (Playwright + test-wallet)
deployments/          testnet.json (committed); local/ (gitignored, per run)
toolchain.json        { aztecNode: "5.0.0", aztecJs: "5.2.0", noir: "5.0.1", halmos: "0.3.3", foundry: "1.7.1", solc: "0.8.28" } — single source of truth
```
Dependency graph (acyclic; `tsc -b` references):
- `bridge-core` ← `deployer` ← `integration`
- `local-network` ← `integration`, `deployer` (dev, local mode)
- `bridge-core` ← `web`

**One viem.** bridge-core, deployer and web use canonical `viem` only. The single `@aztec/ethereum` use in V1 (`OutboxContract` as `OutboxRootsReader`) is re-implemented as a `getRoots(epoch)` view over a viem `PublicClient`. A biome `noRestrictedImports` rule forbids `@aztec/ethereum` and `@aztec/aztec.js/ethereum` in bridge-core and web. This removes V1's canonical/fork split, and with it the hand-rolled `L1Port` seam.

### Contracts

**L1 — `TokenPortal.sol`**: V1 `NuloTokenPortal`, i.e. the canonical Aztec `TokenPortal` plus the F-001 guards (`immutable initializer = msg.sender`; `initialize` reverts on non-initializer and on re-init), **plus [D19]** V2 `TokenPortalImpl`'s `AmountExceedsL2Max`, `InexactTransfer` (deposit pull and withdraw payout) and `nonReentrant` (`ReentrancyGuardTransient`). Content-hash code stays byte-identical to canonical; the guards sit outside the hash preimage. It carries an SPDX Apache-2.0 header with provenance, and compiles against `@aztec/l1-artifacts@5.2.0` Solidity sources via the freeze `gen-remappings` pattern. The Solidity interfaces are unchanged between aztec-packages `v5.0.0` and the 5.2.0 nightly (fable diff; re-verified by the Phase 2 fork test).

**L1 — `Permit2DepositRouter.sol`** (new, trimmed from V1 `SwapBridgeRouter.bridge()`):
```solidity
contract Permit2DepositRouter is ReentrancyGuard {           // ownerless: no sweep, no setters
  ISignatureTransfer public immutable PERMIT2;
  ITokenPortal      public immutable PORTAL;                 // A-1: bound at construction, never calldata
  IERC20            public immutable TOKEN;                  // = PORTAL.underlying(); constructor reverts if 0 or l2Bridge == 0 (portal uninitialized)
  // witness: DepositWitness(bytes32 aztecRecipient,bytes32 secretHash,bool isPrivate)
  function deposit(uint256 amount, bytes32 aztecRecipient, bytes32 secretHash, bool isPrivate,
                   uint256 nonce, uint256 deadline, bytes calldata signature)
      external nonReentrant returns (bytes32 key, uint256 index);
  event Deposit(address indexed depositor, bytes32 indexed aztecRecipient, bytes32 key, uint256 index,
                uint256 amount, bytes32 secretHash, bool isPrivate);
}
```
Rules enforced on-chain:
- `0 < amount <= type(uint128).max`.
- `isPrivate ⇒ aztecRecipient == 0`, and `!isPrivate ⇒ aztecRecipient != 0`.
- The router's balance change per call must be exactly 0 (exact pull, then `forceApprove(amount)` to the portal and reset to 0). Pre-existing donations are fine.
- The pull is `permitWitnessTransferFrom` with `owner = msg.sender`.

Permit2 binds spender (this router), token and amount. The permit deadline is **30 min**, which leaves room for wallet-prompt latency.

**L2 (Noir v5.0.1, verbatim from V1)**:
- `token_bridge`: owner, 2-step transfer, pause (claims **and** exits, [D20]), `claim_public` / `claim_private(recipient, amount, claim_salt, leaf)` / `exit_to_l1_public` / `exit_to_l1_private`.
- `token_minter_proxy`: one-shot `set_token`/`set_bridge`; only the bridge can mint or burn.
- `claim_secret`: the `derive_claim_secret` domain-separator string keeps its `nulo_` prefix.
- `keystone`: cross-toolchain vectors.
- The Token is aztec-standards v5.0.1 `constructor_with_minter("USD Coin", "USDC", 6, proxy, ZERO)`.

**Deploy order.** Local and testnet run the same orchestrator. Every L2 instance is **deployer-bound**: `deployer = deploy account`, never `universalDeploy`. aztec-nr then rejects any other initializer, which closes the proxy/bridge owner-capture front-run. The steps:
1. L1 `TokenPortal`.
2. L2 proxy.
3. L2 Token (minter = proxy).
4. L2 bridge(proxy, portal).
5. `proxy.set_token`, `proxy.set_bridge`.
6. `portal.initialize(registry, USDC, bridge)`.
7. `Permit2DepositRouter(PERMIT2, portal)`.
8. Full verification (below).
9. Write the manifest.

**Full verification** (`deployer verify`, privileged read-backs, all must pass before the manifest is written):
- **L1 runtime bytecode** equals the forge artifacts, with immutable references masked; immutables are checked separately.
- **L1 wiring:**
  - portal `registry`/`underlying`/`l2Bridge`/`rollupVersion`/`initializer`
  - `registry → canonical rollup → inbox/outbox/version` equal node info
  - router `PERMIT2`/`PORTAL`/`TOKEN`
- **L2 class ids** equal the artifacts.
- **L2 wiring:**
  - bridge config (proxy, portal) and bridge owner == deployer
  - proxy owner/token/bridge
  - Token minter == proxy, `auth_contract == 0`, `decimals == 6`
- **Environment:** the SponsoredFPC instance is present, with its Fee Juice balance recorded.

### Key interfaces (bridge-core public surface)

```ts
import type { PublicClient, WalletClient, Hex, Address } from "viem"   // canonical viem
export interface BridgeManifest {            // zod-strict; one definition, imported by deployer + web
  network: "local" | "testnet"
  l1: { chainId: number; usdc: Address; permit2: Address; portal: Address; router: Address;
        registry: Address; inbox: Address; outbox: Address; deployBlock: number }
  l2: { nodeVersion: string; rollupVersion: number; nodeUrl: string; sponsoredFpc?: Hex
        proxy: L2InstanceRecord; token: L2InstanceRecord; bridge: L2InstanceRecord }
}
export interface L2InstanceRecord {
  address: Hex; salt: Hex; deployer: Hex; initializer: string; constructorArgs: string[]
  publicKeys: Hex; classId: Hex
}
export interface L1Ctx { publicClient: PublicClient; walletClient: WalletClient; account: Address }  // wagmi or a viem local account

export type DepositIntent = { amount: bigint; recipient: AztecAddress; kind: "public" | "private" }
export interface DepositDraft {              // created BEFORE signing; in-memory only; the single owner of the secret
  intent: DepositIntent; secretOrSalt: Fr; secretHash: Fr; permit: { nonce: bigint; deadline: bigint }
  typedData: TypedData
  submission?: { account: Address; chainId: number; fromBlock: bigint }  // fromBlock = the FINALIZED block, captured BEFORE the send request
  l1TxHash?: Hex                             // attached the moment the wallet returns it (may never arrive, may be replaced)
}
export type ClaimTicket = { draft: DepositDraft; messageHash: Hex; leafIndex: bigint }
export type Reconciled = ClaimTicket | "pending" | "not-deposited"
  // "not-deposited" ONLY after a complete, error-free scan from fromBlock through a finalized block whose
  // timestamp > permit deadline (Permit2 checks block.timestamp). Any RPC error or partial scan → "pending".

export function prepareDeposit(i: DepositIntent, m: BridgeManifest, now: () => bigint): Promise<DepositDraft>
export function submitDeposit(d: DepositDraft, l1: L1Ctx, m: BridgeManifest, on?: StageSink): Promise<Hex>        // sets d.submission, then d.l1TxHash
export function reconcileDeposit(d: DepositDraft, l1: L1Ctx, m: BridgeManifest): Promise<Reconciled>
  // never re-sends. Tries the tx hash first; whenever that does not establish the matching deposit (unknown, dropped,
  // replaced, not found), it ALSO runs a `Deposit` log scan on manifest.l1.router from submission.fromBlock, filtered by
  // depositor == account AND secretHash (unique per draft). Covers lost wallet responses, replaced (sped-up/cancelled)
  // txs and re-mining below the pre-send tip after a reorg.
export function waitClaimable(t: ClaimTicket, node: AztecNode, wallet: Wallet, on?: StageSink): Promise<void>
export function claim(t: ClaimTicket, wallet: Wallet, m: BridgeManifest): Promise<ClaimResult>                   // "claimed" | "already-consumed"
export function exitToL1(e: ExitIntent, wallet: Wallet, m: BridgeManifest): Promise<ExitTicket>
export function exitTicketFromTx(l2TxHash: TxHash, recipient: Address, amount: bigint, node: AztecNode, l1: PublicClient,
  m: BridgeManifest, occurrence?: number): Promise<ExitTicket | "all-consumed" | "not-found">
  // resume. Recomputes the expected message. With several identical occurrences in the tx, it picks `occurrence` if given,
  // else the first one NOT yet consumed on the L1 Outbox. "all-consumed" is returned only when every occurrence is consumed;
  // a wrong recipient/amount returns "not-found" (never "withdrawn").
export interface ExitTicket { l2TxHash: TxHash; recipient: Address; amount: bigint; messageHash: Hex; messageIndexInTx: number }
export function waitWithdrawable(t: ExitTicket, node: AztecNode, l1: PublicClient, m: BridgeManifest, on?: StageSink): Promise<OutboxProof>
export function withdrawOnL1(t: ExitTicket, p: OutboxProof, l1: L1Ctx, m: BridgeManifest): Promise<Hex>
export function assertNetworkIdentity(node: AztecNode, l1: PublicClient, m: BridgeManifest): Promise<void>
export function assertSigningContext(l1: L1Ctx, wallet: Wallet | null, m: BridgeManifest, expected: { l1Account: Address; l2Account?: AztecAddress }): Promise<void>
```

### Data & control flow (critical paths)

**Deposit (L1 → L2):**
1. `assertNetworkIdentity`: node `nodeVersion`/`l1ChainId`/`rollupVersion` and `registry → inbox/outbox` must equal the manifest.
2. `ensurePermit2Allowance`: if `USDC.allowance(user, PERMIT2) < amount`, show the unlimited-approval risk note, `approve(PERMIT2, max)`, then re-read and fail closed.
3. `prepareDeposit` builds the draft **before any signature**:
   - Public: `secret = Fr.random()`.
   - Private: `salt = Fr.random()`, `secret = deriveClaimSecret(salt, recipient)`, and the `aztecRecipient` word is 0.
   - Both: `secretHash = computeSecretHash(secret)`, with a 30-min permit deadline.
   - `AztecAddress.isValid(recipient)` is checked fail-closed.
4. The review screen shows exactly: amount, public/private, the recipient (for private: "committed privately; your wallet will show only a hash"), and the router/portal addresses.
5. `assertSigningContext`, then `signTypedData`, then `assertSigningContext` again. Record `d.submission` (account, chain, **finalized** block), then send `router.deposit`. `d.l1TxHash` is set the instant the wallet returns it.
6. Receipt: `awaitL1Receipt` (retry + direct probe) and assert `status === "success"`. The leaf index and message hash come from the **mined** logs, emitted by the manifest router address.
   - On any failure, including a lost wallet response with no hash or a replaced tx, the draft is kept. The UI offers "keep waiting / re-check", which runs `reconcileDeposit` and never re-sends.
   - The UI only offers "discard this draft" after `reconcileDeposit` returns `"not-deposited"`: a complete scan through a finalized block whose timestamp is past the permit deadline.
7. `waitClaimable`: poll the message checkpoint until the wallet's PXE anchor passes it, gated on a successful claim simulation with a bounded retry budget.
8. `claim`, wrapped in `retryOnUnregistered` (re-register once, identity fence):
   - Public: `claim_public(recipient, amount, secret, leaf)`.
   - Private: `claim_private(recipient, amount, salt, leaf)` with `paymentMethod = SponsoredFeePaymentMethod(manifest.l2.sponsoredFpc)`.
   - Sponsor exhausted or the payment rejected: a clear error, and the ticket is kept. The user can retry, or explicitly choose the wallet default after an "this may link your account" confirmation.
   - "Already consumed" is shown as "already claimed".

**Withdraw (L2 → L1):**
1. `exitToL1`:
   - **Before any burn**, it refuses `recipientL1` equal to zero or to the portal. The [D19] payout check is a **portal-debit** check, and a USDC self-transfer never debits, so an exit to the portal could never be withdrawn.
   - Private: an off-chain authwit (`caller = proxy`, `burn_private`), then `exit_to_l1_private(recipientL1, amount, callerOnL1 = 0, nonce)`, requesting a sponsored payer (same fallback rule as private claims).
   - Public: `SetPublicAuthwit(caller = proxy, burn_public)` via the auth registry, then `exit_to_l1_public`.
2. `waitWithdrawable`: poll the receipt until mined, then `waitForProven` (timeout ≥ 60 min, extendable, state kept). Compute the **expected** message: `withdrawContentHash(recipient, amount, 0)` wrapped with (bridge, portal, rollupVersion, chainId).
   - **Locate it** in the tx effect's `l2ToL1Msgs` and record its occurrence index; never assume `[0]`. Zero matches → reject. For a fresh exit the index is known from the send; on resume, the selection rule in `exitTicketFromTx` applies.
   - Build the membership witness with `@aztec/stdlib`'s `computeL2ToL1MembershipWitness`, passing that index and our viem roots reader.
   - The helper can fail **during construction**: a root mismatch throws, and a missing covering root returns `undefined`. A missing root means "pending" (the ticket is kept; wait and retry). A mismatch triggers a bounded rebuild from current proven state (max 3 attempts), then an error with the ticket kept.
3. `withdrawOnL1`: simulate, then write the 7-arg `portal.withdraw(recipient, amount, false, epoch, numCheckpointsInEpoch, leafIndex, path)`.
   - A root/path revert at simulation gets the same bounded rebuild.
   - An "already consumed" revert marks **that occurrence** withdrawn only.
4. Resume: `exitTicketFromTx(l2TxHash, recipient, amount, …, occurrence?)` recomputes the expected message, verifies it is in that tx, and selects an unconsumed occurrence. The UI "Finish a withdrawal" form asks for tx hash, recipient (defaulting to the connected L1 account) and amount. A mismatch says "no withdrawal matching these details in that transaction", never "already withdrawn".

### File-level change map (all additions — greenfield repo)

| Path | Origin |
|---|---|
| root scaffold: `package.json`, `bunfig.toml`, `biome.json`, `tsconfig*.json`, `toolchain.json`, `commitlint.config.ts`, `.husky/`, `.lintstagedrc`, `AGENTS.md` + `CLAUDE.md`, `README.md`, `LICENSE` (Apache-2.0), `.gitignore` (incl. `.env*`, `deployments/local/`), `.github/workflows/{actionlint,contracts,_contracts,bridge-core,web,_e2e}.yml`, `docs/assurance-map.md`, `.github/actions/setup-toolchains/` | my-stack |
| `contracts/evm/src/TokenPortal.sol`, `interfaces/{ITokenPortal,ISignatureTransfer}.sol` | V1 + [D19] V2 portal guards (+`underlying()`/`l2Bridge()` on `ITokenPortal`; SPDX) |
| `contracts/evm/src/Permit2DepositRouter.sol` | adapted from V1 `SwapBridgeRouter.bridge()` + freeze guards |
| `contracts/evm/test/**`, `.gas-snapshot` | V1 portal/router tests (bridge half) + the V2 QA port (Solidity list): real-Outbox, portal/router invariants, fuzz, halmos + canaries, shared mocks, Sepolia fork |
| `contracts/evm/test/mocks/MockUsdc.sol` | new (6 dp, no forced allowance; local/test only) |
| `contracts/aztec/**` | V1 verbatim + the V2 QA port (Aztec.nr list: 14 TXE tests, manifest, `txe-server/`, `nargo-5.sh`, hardened sole-consumer, `compile.sh --check`) + `noir-deps.sh` |
| `packages/bridge-core/src/{content-hash,claim-secret,l2,l1-receipt,progress,status}.ts` | V1 verbatim |
| `packages/bridge-core/src/{permit2,deposit,claim,exit,withdraw,outbox,fees,manifest,network,errors,artifacts,index}.ts` | adapted from V1 `l1.ts`/`flows.ts`/`fee-juice.ts`/`candidate-schema.ts`/`artifacts.ts` + nulo #607 |
| `packages/local-network/src/{network,ports,handle,cli}.ts` | adapted from freeze `local-network.ts`/`handle.ts` |
| `packages/deployer/src/{preflight,deploy-l1,deploy-l2,verify,manifest,smoke,secrets,cli}.ts` | new, patterned on freeze `deploy.ts` + V1 deploy scripts; `bytecode/permit2.json` from freeze (local only) |
| `packages/integration/test/*.test.ts` | new, patterned on freeze `bridge-core/test/integration` |
| `apps/web/src/wallet/{aztec-session.ts,useAztecSession.ts,l1.ts,capabilities.ts}` | adapted from V1 `createAztecWalletSession.ts` / `capabilities.ts` (combined-manifest grants) |
| `apps/web/src/**` (routes, components, lib) | new React UI (placeholder look) |
| `apps/web/e2e/**` | adapted from freeze harness design |
| `apps/web/{wrangler.jsonc,public/_headers}` | my-stack template + COOP/COEP/CSP/frame-ancestors |

### Non-obvious mechanics
- **Three-toolchain pins.** Content hashes and claim-secret derivation are pinned by identical literal vectors in Noir (`keystone`), Solidity (`ContentHash.t.sol`) and TS. The witness typehash and witness hash are pinned in Solidity and TS against one literal, **plus** mutation tests: flipping any field, the chain id, the spender or the nonce must change the hash or revert. Two sides agreeing on one literal can still share one mistake.
- **PXE-anchor claim gating.** Gate on a successful simulation, not on node visibility or a timer.
- **Secrets never cross a process boundary or reach disk.**
  - The testnet keys live in `.env.testnet` (git-ignored, mode `0600`, **already provisioned 2026-09-25 at the user's request**). The L1 key is reused from nulo's Sepolia-only deployer: address `0xFcc2238319aC360e985f1736aBB3df6251DAF6F5`, no mainnet history. The Aztec secret was freshly generated. The deployer reads the file in-process and refuses if its mode is wider than `0600`.
  - Deploy and smoke wallets/PXEs are **ephemeral** (in-memory stores). No wallet DB or PXE dir is written, and teardown clears them.
  - Child processes (forge, aztec) get a scrubbed env.
  - `secrets:scan` runs in-process over tracked + untracked files, `deployments/`, logs and any generated artifact dirs. `.env.testnet` itself is the only exclusion. It prints a boolean only, and is tested with dummy secrets planted in each covered location.
- **Noir dep integrity.** `noir-deps.sh` only fetches and verifies; it never compiles:
  1. **fetch**: explicitly clone every pinned (url, tag, commit) dependency, including transitive ones, into the nargo cache; missing entries are fetched, never skipped.
  2. **verify**: each tree's `HEAD` equals the pinned commit **and** `git status --porcelain` is empty (unmodified contents).

  `compile.sh` then compiles from that verified cache. In the gate, `compile.sh --check` is the **only** compilation, so its baseline is never a fresh build.

  Tests: an empty cache ends verified; a modified source file and a wrong commit are both rejected. CI runs it on a clean cache.

### Trade-offs & alternatives not taken
- **Keep `token_minter_proxy`.** It breaks the Token-minter/bridge address cycle, it is red-teamed (F-002), and it is TXE-covered. Outline B only moves the one-shot setter into the bridge.
- **Ownerless router.** Nothing for an owner to do legitimately.
- **Keep bridge pause + owner, claims and exits ([D20], user).** It is the incident lever: it can halt L2 minting as well as exits. The cost is accepted risk 4. On testnet the user keeps the key. Mainnet custody is deferred.
- **Permit2, unlimited approval** (user decision). EIP-2612 direct (exact amount, no standing allowance) was recommended and declined. Permit2 exact approval was rejected: 2 txs + 1 signature per deposit.
- **wagmi 3 + viem, injected-connector transport only.** Reads go through the wallet provider. That removes **app-controlled** RPC egress and keeps `connect-src` to self + node. The wallet's own RPC provider still sees the requests, and its method support and rate limits vary. Unsupported methods and disconnects surface as retryable errors, with the draft kept.
- **One viem** (drop `@aztec/ethereum`) rather than V1's dual-viem `L1Port` seam.
- **Local network pinned to node 5.0.0** (== testnet) with JS 5.2.0. This proves **execution/API** compatibility of the mixed pairing in Phase 6. The local network settles epochs synthetically and does not verify real proofs by default, so **proof acceptance** is proven on the real testnet: first by the Phase 1 keyless spike, then by the Phase 7 smoke.
- **`packages/integration`** as a tests-only package rather than tests inside bridge-core, which would create a dependency cycle.

---

## Competing outline B — "minimal surface" (rejected; see ledger D2)

The idea: no `token_minter_proxy` (bridge = Token minter via a one-shot `set_token`), no owner/pause on the bridge, ownerless router, no halmos, 2 arcs. Both audits preferred A. B saves one contract and hop but no authority, since it keeps a one-shot owner-gated setter while claiming "no owner". It forfeits the TXE suite and the red-team lineage, and removes the incident lever from a value-bearing bridge.

---

## Security & Adversarial Considerations

**Threat model — assets:** USDC held by the portal (the whole bridged float), the L2 mint authority, users' USDC balances exposed through the Permit2 allowance, and users' recipient privacy. **Attackers:** anyone on L1/L2; phishing front-ends; supply-chain compromise (npm/Noir/forge deps); whoever holds the admin keys; the Aztec sequencer (censorship).

| Surface | Risk | Control |
|---|---|---|
| Portal init | Repoint registry/underlying/l2Bridge → drain (F-001) | init-once + deployer-only (V1); full read-back verify |
| Portal direct calls | Bypassing the router: a USDC fee/upgrade makes L2 credit exceed the L1 reserve (silent insolvency); u128 overflow; re-entry | [D19] exact-transfer deltas on pull and payout, u128 cap, `nonReentrant`; reserve invariant (`TokenPortalInvariant`) |
| L2 init | Front-run proxy/bridge initializer → owner capture (pause lever) under universal deploy | deployer-bound instances (aztec-nr rejects other initializers); owner read-backs; attacker-first-init integration test |
| Router | Steered portal (A-1); uninitialized-portal brick; fee-on-transfer/upgrade; u128 overflow | immutable PORTAL/TOKEN; constructor reverts on an uninitialized portal; exact pull; u128 cap; nonReentrant; ownerless |
| Signatures | (a) Stolen router signature: **unusable**, since only `owner == msg.sender` submits. (b) **Malicious-spender Permit2 signature** drains the full balance via the unlimited allowance (accepted risk 2). (c) Malicious deposit tx approval on a clone site | (b) disclosed at the approval step. (c) Review screen with exact values; a private commitment is opaque in typed-data displays and the UI says so. `frame-ancestors 'none'` + CSP stop framing/injection on **our** origin but cannot authenticate a clone. |
| L1→L2 claim | Replay; wrong recipient; bearer secret (F-007) | Message nullifier; public content hash binds `to`; private secret derived in-circuit; `check-sole-consumer.sh` |
| L2 mint authority | Extra minters (F-002) | one-shot `PublicImmutable`; no `set_minter`, no owner mint; read-backs |
| L2→L1 withdraw | Replay; spent leaf reopened by an extending proof; caller binding; wrong message index | Real-Outbox tests (freeze); message located by content, not position; delta assertions |
| Content-hash drift | Strands every deposit | Three-toolchain literal pins + mutation tests in CI |
| Privacy | **Amounts are public on L1 and L2** (L2 Token supply `Transfer{to: PRIVATE_MAGIC, amount}` events on private mint/burn; bridge/proxy named in the public phase); timing correlation; fee payer links identity (#554) | Copy: "private hides **who** receives on Aztec, not **how much** or **when**". A sponsored payer is requested for private ops (wallet-dependent, accepted risk 3); an explicit informed fallback |
| Admin keys | Bridge owner can pause claims and exits: it can censor, and with no persistence a long claims pause can destroy in-memory deposits (accepted risk 4); proxy owner bootstrap-only; portal initializer init-only | Testnet: the user keeps the throwaway deployer key (it is the pause key). Mainnet custody → Deferred. |
| Network identity | Wrong chain/rollup/contracts | `assertNetworkIdentity` (version + chain + registry→inbox/outbox); manifest build-embedded; `assertSigningContext` re-checked at every sign/send boundary |
| Frontend | XSS; clickjacking; wallet-supplied strings; RPC egress leaking IP/address | React escaping, no `dangerouslySetInnerHTML`; V1 grant sanitization; CSP `default-src 'self'; connect-src 'self' <node>`; `frame-ancestors 'none'`; COOP/COEP; injected-only transport |
| Deploy keys | Leak via logs/argv/env/shell history | `.env.testnet` 0600 read in-process; scrubbed child env; boolean in-process secret scan; redacted logs |
| Network lifecycle | Aztec rollup upgrade binds the portal to the old rollup; Circle blacklist of the portal; Circle blacklist of a withdraw recipient (the recipient is fixed in the message); L2 pause strands in-flight deposits (INFO-2) | Documented residuals → Deferred. A blacklisted recipient's withdraw reverts atomically and stays retriable (tested). INFO-2 is accepted risk 4, mitigated by refusing new deposits while paused |

- **Least privilege:** workflows `permissions: contents: read`; no secrets in CI; actions pinned by SHA.
- **Cryptography:** no custom crypto. `@aztec/foundation@5.2.0` (poseidon2, secret hash), WebCrypto sha256, viem EIP-712, `Fr.random()` CSPRNG.
- **Input validation:** zod-strict manifest; amounts at 6 dp, `> 0`, `≤ balance`, `≤ u128`; `AztecAddress.isValid`; L1 checksum; hardened wallet-sdk grant parsing.
- **Supply chain:** `minimumReleaseAge = 604800` + isolated linker; frozen lockfile; `bun audit`; exact `@aztec/*` pins; OZ + forge-std via npm; Noir deps asserted by commit before compile on a clean cache.
- **Deferred to mainnet (explicit):** admin-key custody (multisig/timelock); rollup-upgrade story; the mainnet fee path (no SponsoredFPC); a relayer (recipients must `registerSender(relayer)` for note discovery, per aztec-nr tagging); external audit; a `/harden` re-run on the final contracts; a revisit of EIP-2612 vs unlimited Permit2.

---

## Assumptions

### Facts (verified)
1. V1 = nulo `4df5eae5`; V2 = #536–#540 (`1d40d56e`…`6b07138b`). Source: `git log`.
2. nulo is Apache-2.0 (`LICENSE` @`4df5eae5`/`14f1edd8^`).
3. Testnet node 5.0.0, `l1ChainId 11155111`, `rollupVersion 1821665230`, inbox `0x3047…4f7c`, outbox `0x905f…42ff`, registry `0xa0bf…c6ba`. Source: `node_getNodeInfo`, 2026-09-25.
4. Circle Sepolia USDC `0x1c7D…7238`: 6 dp, FiatToken `version "2"`, EIP-2612, proxy. Permit2 `0x0000…BA3` is deployed on Sepolia. Source: `cast`, 2026-09-25.
5. The canonical SponsoredFPC `0x0628…3fe1` (5.0.0 CLI) is **published on testnet** (`node_getContract`, 2026-09-25). Its balance is not yet read.
6. V1/freeze pins: `@aztec/*` 5.2.0 JS; Noir v5.0.1; compile `~/.aztec/versions/5.0.1`; local network from the JS pin. `~/.aztec/versions/5.0.0` is installed locally.
7. V1 `SwapBridgeRouter.bridge()` takes `tokenPortal` from calldata (A-1).
8. V1 `claim_private` derives the secret in-circuit; the private content hash omits the recipient.
9. V1 deployed L2 instances with `universalDeploy: true` (`deploy-bridge-testnet.ts:234`). aztec-nr v5.0.1 accepts any initializer when deployer is 0 (`initialization_utils.nr:159-172`). The proxy/bridge constructors set owner = `msg_sender`.
10. aztec-standards Token v5.0.1: `constructor_with_minter(name, symbol, decimals, minter, auth_contract)`; private mint/burn emit public supply `Transfer` events with the amount (`main.nr:447-453, 670-693`).
11. V1 `buildBridgeManifest` lacks the `STANDARD_AUTH_REGISTRY_ADDRESS.set_authorized` grant that public exits need (`capabilities.ts:284,327` are in the combined manifest only).
12. V1 withdraw reads `l2ToL1Msgs[0]` (`flows.ts:219`); V1 private exits set no app fee (#554).
13. The red-team found no contract CI (F-003, 2026-06-14); V1 fixed it (`contracts.yml` → `_bridge-contracts.yml`, paths-filtered, halmos name/count-pinned). wagmi latest = 3.7.7. `shield.human.tech`/`aztec-kit` have no license.
14. The Solidity messaging interfaces are unchanged between aztec-packages `v5.0.0` and the 5.2.0 nightly (fable diff of IOutbox/IInbox/IRollup/IRegistry/DataStructures/Hash/TokenPortal). This establishes source compatibility only, not proof or deployment compatibility.
15. The L2→L1 message publishes only `sha256("withdraw(address,uint256,address)", recipient, amount, caller)`; `l2ToL1Msgs` are hashes (`token_bridge/src/main.nr` @V1; aztec `tx_effect.ts`). Recovering an exit therefore needs the recipient + amount.
16. The local network settles epochs synthetically and defaults `realProofs` to false (aztec `v5.0.0` `local-network.ts`; the freeze harness disables proving). Local runs prove execution/API compatibility, not proof acceptance.
17. `computeL2ToL1MembershipWitness` rejects ambiguous identical messages unless given an index (`stdlib/src/messaging/l2_to_l1_membership.ts`).

Facts 3–5 are **time-sensitive probe results**; the Phase 1 and Phase 7 probes re-read them before use.

### Inferences (unverified — attack these)
1. The JS 5.2.0 client works against node 5.0.0 with 5.0.1-compiled contracts. **Proof acceptance** is proven by the Phase 1 keyless spike and the Phase 7 smoke (real testnet). **Execution/API** is proven by Phase 6 (local node 5.0.0). **Fallback rule:** if it fails, pin JS to the newest 5.0.x that passes and log it.
2. The testnet SponsoredFPC holds at least the estimated fee budget for the deploy + smoke. **Checked by** the Phase 1 probe and re-checked right before Phase 7 spends. A non-zero balance alone is insufficient. **Fallback:** hold Phase 7 and surface (fee path = SponsoredFPC only).
3. `aztec start --local-network` 5.0.0 deploys a funded SponsoredFPC at the canonical address. **Proven by** Phase 5.
4. The embedded test wallet honors a dApp `paymentMethod`, and the submitted payer is observable in the tx. **Proven by** Phase 6 (Node) and Phase 10 (browser). Third-party wallets: best effort, unproven.
5. The freeze `local-network.ts` ports with only V2-hub stripping and runs node 5.0.0.
6. The Circle faucet provides ≥ 5 Sepolia USDC; the user funds the throwaway accounts.
7. Testnet epoch proof completes within 60 min; the timeout is extendable and state is kept.
8. The wagmi 3 injected connector works against the Playwright shim (targeting `window.ethereum` explicitly). **Proven early** by the Phase 8 connect spec.

### Asks
Resolved with the user (2026-09-25): no persistence; Permit2 unlimited; `/harden` contracts-only after all arcs; throwaway key via env, kept by the user as the testnet pause key; any wallet-sdk wallet best-effort; Circle Sepolia USDC; root commit to main at delivery; mid tier.
Resolved at the approval gate (2026-09-25):
1. **wagmi 3.7.7**: yes.
2. **License**: Apache-2.0, no `NOTICE` file (the user owns nulo). `TokenPortal.sol` keeps the upstream aztec-packages SPDX/copyright header line, which is the one attribution Apache-2.0 §4 requires for that forked file.
3. **"Finish a withdrawal" (L2 tx hash + recipient + amount) + `beforeunload` guard**: include.
4. **Keys**: `.env.testnet` was provisioned by the driver on request (see Non-obvious mechanics). **Remaining user action:** fund `0xFcc2238319aC360e985f1736aBB3df6251DAF6F5` with ≥ 5 Circle Sepolia USDC before Phase 7. It has 4.39 Sepolia ETH and 0 USDC (checked 2026-09-25).
5. **V2 QA port**: the user asked that V2's (much stronger) Solidity / Aztec.nr / TS test suites be farmed into this plan, so the V1 contracts ship with V2-grade assurance. See "V2 QA port" below.
6. **D19 portal guards**: add them (the recommendation). **D20 pause scope**: keep V1's claims + exits pause (the user overrode the exits-only recommendation), which adds accepted risk 4 and its mitigations.

---

## V2 QA port

Three read-only sweeps compared nulo V2 (`6611f861`) with V1 (`4df5eae5`): Solidity, Aztec.nr, and TS/e2e. The raw reports are in `research/v2-qa-{solidity,aztec-nr,ts}.md`. This section is the filtered verdict, and it wins over the raw reports; the driver re-verified their load-bearing claims against nulo history, and two were wrong (see the report headers).

**Rule.** Port every test whose property exists in our design. Drop anything keyed to the factory, clones, hub, registration, the fuel/swap leg, drip, the token list, journal/backup, the owner/sweep/guardian of V2's router, or multi-fee-mode cells.

**What the sweeps found**
1. **L2: no bugs, only coverage debt.** None of V2's 65 TXE tests fails against V1's Noir code once translated: every assert V2 exercises already exists in V1. V1 simply has 14 of those properties untested. V2's tooling (manifest gate, pinned TXE server, class-id parity, a hardened sole-consumer guard) is strictly better. *(high confidence: all V1 crate sources read in full)*
2. **L1: the portal carries real gaps.** V1's portal is canonical `TokenPortal` + F-001 only, so it has no u128 cap, no exact-transfer check and no reentrancy guard. The router's checks do not protect anyone who calls the portal directly. V1 also lacks a portal reserve invariant, a real-Outbox withdraw test, a gas snapshot, and halmos canaries. → **D19**.
3. **TS/e2e: V1 had none.** Its "e2e" suites were jsdom components with every chain mocked. V2 built the real local-network integration + Playwright harness from scratch. This plan already adopts that design; the port adds V2's fault injection and robustness specs.
4. **Pause scope diverges.** V1 pauses claims **and** exits; V2 pauses exits only. → **D20**.

### D19 — portal guards (user: adopt)
Port V2 `TokenPortalImpl`'s three guards into `TokenPortal`:
- `AmountExceedsL2Max`: deposits cap `amount ≤ type(uint128).max`.
- `InexactTransfer`: the portal's own balance delta must equal `amount` on the deposit pull and on the withdraw payout. On the payout this is a **portal-debit** check, not a recipient-credit check. A payout to the portal itself never debits, so `exitToL1` refuses the portal as a recipient before burning.
- `nonReentrant`, via OZ `ReentrancyGuardTransient`.

Why:
- **All three sit outside the sha256 content-hash preimage.** The guard runs, then the hash is computed, then the delta-checked pull (V2 source). The keystone literals therefore do not move.
- **Exact-transfer is the guard that matters.** Circle USDC is an upgradeable proxy. If it ever charged a transfer fee, an unguarded portal would credit L2 more than it holds (silent insolvency). The guarded portal refuses deposits instead.
- **The u128 cap is hygiene.** USDC's whole supply (~10¹⁷ base units) is far below 2¹²⁸, so the cap only matters for `MockUsdc`.
- **Reentrancy is defense in depth.** USDC has no transfer hooks.

Cost: the portal is no longer "canonical + F-001 only" (a ~20-line diff, documented in the header), plus one halmos proof and its canary.

### D20 — pause scope (user: keep V1's claims + exits)
The recommendation was exits-only (V2's model). The reasoning: with no persistence, a claims pause makes anyone with an unclaimed deposit keep their tab open or lose it. The user kept V1's model, which can halt L2 minting during a claim-path incident.

Consequences:
- L2 stays V1-verbatim; the existing `claim_*_paused_rejected` TXE tests stay.
- Accepted risk 4 is added. Its mitigations:
  - **Phase 9:** the deposit form refuses to start while `is_paused` is set; paused copy appears on the unclaimed-deposit screen.
  - **Phase 6 spec 15:** paused bridge → a new deposit is refused before signing; an in-flight deposit claims after unpause.

### Port list — Solidity (Phase 2)
Kept from V1 as-is:
- `ContentHash.t.sol`, `PortalReinit.t.sol`, `FormalPortal.t.sol` (F-001), `PortalRoundtripFuzz.t.sol`.

Adapted from V2, plus new work:
- **`TokenPortal.t.sol`** (from V2 `PortalFactory.t.sol`, the clone-level tests):
  - direct portal deposits commit the canonical hash (public, private)
  - withdraw consumes the message and debits exactly
  - [D19] u128 cap; a fee-on-transfer deposit and a sender-surcharge withdraw → `InexactTransfer`; a hooked token re-entering → reverts
- **`PortalWithdrawRealOutbox.t.sol`** (from V2 `CloneWithdrawRealOutbox`, minus the cross-clone test):
  - a message pays once
  - an extending proof does not reopen a spent leaf
  - a caller-bound message is delivered only by its caller
  - wrong recipient, amount, position, out-of-range leaf index and wrong epoch each revert with the exact `Outbox__*` / `MerkleLib__*` selector
  - **new (no V1/V2 precedent):** a blacklisted L1 recipient reverts atomically, leaves the nullifier unconsumed, and succeeds once un-blacklisted
- **`TokenPortalInvariant.t.sol`** (from V2 `invariant_reserveEqualsNetDeposits`; V1 had no portal invariant):
  - randomized multi-actor deposits and withdraws
  - `USDC.balanceOf(portal) == Σdeposits − Σwithdrawals`, measured against the real balance, never ghost-vs-ghost
- **`Permit2DepositRouter.t.sol`** (from V2 `SwapBridgeRouter`'s fuel-less subset + Blackhat F-B/F-E/F-L):
  - public and private happy paths
  - every revert pinned to its exact selector
  - a pre-seeded donation leaves the accounting unchanged
  - fee-on-transfer → `InexactPull`, with nothing leaving the user
  - a hooked token re-entering `deposit` → reverts
  - uninitialized portal → the constructor reverts
  - `test_gas_deposit`
- **`Permit2DepositRouterFuzz.t.sol`**:
  - each witness field XOR-mutated changes the hash (address fields masked to 160 bits so a truncation can't false-pass)
  - over the full u128 domain: the portal receives exactly `amount`, router residue is 0, and router→portal allowance is 0 before and after
- **`Permit2DepositRouterInvariant.t.sol`**:
  - the router holds exactly the donations
  - the portal received exactly Σ(successful amounts)
  - the allowance is 0 between calls
- **Halmos**:
  - `FormalRouter.t.sol`: `check_deposit_conservesUserFunds`, `_rejectsZeroAmount`, `_rejectsAmountAboveU128`, `_privateRequiresZeroRecipient`, `_publicRequiresRecipient`
  - `FormalPortal.t.sol` adds [D19] `check_deposit_rejectsAmountAboveU128`
  - **every proof has a forge canary**: a mutant with that one guard deleted must fail it (V2's `RouterWithoutPortalRule` pattern)
- **Sepolia fork**: nonce replay, expired deadline and witness tamper revert, **and** the Permit2 nonce bitmap is unchanged after the tamper revert.
- **`MockUsdc.t.sol`**: no Permit2 auto-allowance (the V2 `TestUsdc` control for INFO-1).
- **Shared `test/mocks/`**:
  - `AztecFakes.sol` (it replaces V1's two drifting inline copies)
  - `RouterFixture.sol`, `MockPortal.sol`, `MockPermit2`
  - `FeeOnTransferERC20`, `SenderSurchargeERC20`, `HookERC20`, `BlacklistableERC20`
- **Infra**:
  - Foundry pinned to **1.7.1** in `toolchain.json`. V2's CI records that 1.8.1 + halmos 0.3.3 proved 0 of 12 proofs.
  - `.gas-snapshot` with `forge snapshot --match-test test_gas_ --no-match-contract Fork --check --tolerance 2`.
  - Strict halmos gate: exact proof names, per-contract counts and zero failures, so a renamed or deleted proof fails CI.
  - `contracts.yml`: the paths-filtered caller + reusable workflow + a status job that treats "never ran" as a failure.

### Port list — Aztec.nr (Phase 3)
- **14 new TXE tests** (the asserts already exist in V1 code):
  - `claim_public_wrong_amount_rejected`
  - `claim_public_by_relayer_credits_the_recipient`
  - `claim_private_zero_amount_rejected`
  - `exit_{public,private}_without_authwit_rejected`
  - `exit_{public,private}_zero_amount_rejected`
  - direct calls to `#[only_self]` `_assert_not_paused` and `assert_bridge` rejected, for a stranger **and** for the owner (4 tests)
  - `non_owner_cannot_pause`
  - `exits_resume_after_unpause`
  - `pause_state_tracks_toggles`

  Also:
  - Strengthen `claim_private_via_relayer_*`: the relayer's balance stays 0.
- **`txe-manifest.txt`** + gate in `run-txe-tests.sh` (`--show-output`): every named test must appear as passed, with a floor equal to the current count. `nargo test` exits 0 when zero tests ran, or when a `should_fail` passes vacuously on a TXE crash.
- **`txe-server/`**: a committed package (`@aztec/txe@5.0.1` + `bun.lock`, installed with `--frozen-lockfile`). It replaces V1's ad-hoc `bun add` into a home-dir cache.
- **`TXE_TEST_THREADS=2`**: the TXE lmdb store opens with `maxReaders 2`, and 4 threads aborted V2's CI mid-suite.
- **`nargo-5.sh`**: a pinned-toolchain wrapper. A bare `nargo compile` overwrites the committed transpiled artifact.
- **`check-sole-consumer.sh` hardening**:
  - string-literal-aware comment stripping
  - consume sites counted across every non-test `.nr` file, not lines in one file
  - 4 more self-test regressions: a one-line double consume, commented-out shapes, and `//` and `/* */` inside string literals
- **`compile.sh --check` + `noir-class-id.ts`** rebuild from source with the pinned toolchain. The baseline is the **HEAD-committed** artifacts (`git show HEAD:…`), not working-tree copies. Two checks must pass, and the working tree is restored afterwards:
  1. **Class-id parity.** The derived class id must equal the committed one. V2 showed that a one-character change to `claim_public`'s body turns this red.
  2. **SDK-facing ABI parity.** The class id alone misses public ABI corruption: `artifact_hash.ts` excludes public ABI entries, and renaming `claim_public` in the JSON left the class id unchanged (codex, verified). So the check also compares normalized ABI metadata: function names, selectors, parameter and return types, and the storage layout.

  A regression mutates `claim_public`'s name in a copied artifact and asserts `--check` fails. **Together these replace the byte-level `git diff --exit-code` gate.**
- **`docs/assurance-map.md`** (V2's `txe-ts-map.md`, generalized): each cross-boundary property → its Noir, Solidity, TS unit, integration and e2e tests. Integration and e2e specs carry the same cell ids (e.g. `D1` = public deposit → claim).

### Port list — TS / integration / e2e (Phases 4–10)
- **Phase 4 (unit):**
  - Deposit event parsing counts only the router's own `Deposit` log, and exactly one per receipt. A same-signature log emitted by the token during the pull is ignored (a V2 hostile-ERC20 incident).
  - `walletChainIdOf(l1ChainId, rollupVersion) = (l1 ^ v) >>> 0`, pinned to testnet `1816023401`; the wallet handshake uses it. A V2 deploy bug once wrote the bare rollup version, which no wallet could use.
  - ABI pins: the hand-written router/portal ABIs equal the forge artifacts, and so do the re-pinned class ids.
    - Artifact reads happen inside `it()`, so test collection never crashes where contracts aren't built.
    - The CI job builds the contracts first and never silently skips.
  - Each TS mirror of an on-chain rule gets one mutation test per rule.
- **Phase 5:**
  - `verify` runs against a fresh `forge build --force`; a stale or missing `out/` fails rather than skips.
  - The harness force-builds a block every 3 s while tests run. The local network only builds blocks on txs, so L1→L2 message readiness would otherwise never advance.
- **Phase 6:**
  - Spec 3 continues: after the wrong-recipient attempt fails, the same relayer submits for the right recipient and it lands.
  - Spec 5 asserts that the Outbox reads not-consumed before the withdraw and consumed after.
- **Phase 8 harness:**
  - **Test-wallet fault injectors** (`failNext`/`holdNext`/`swallowNext`/`dropNext` matched by target, and `declineNextGrant`).
  - **L1-wallet shim** with `rejectNext`/`holdNext`/`swallowNext`, per-method call counts, captured Permit2 signatures, and chain/account-change events.
  - **Egress fence** as an auto fixture that asserts zero blocked requests on every test.
  - **Deterministic actors** seeded in Node and injected only into the wallet origin, with worker-scoped pools and retry spares.
  - **One origin per wallet profile.**
  - The `detect-node` tripwire + a Node JSON-import hook for the bundled wallet.
  - The connect spec adds three cases: a wallet frame loading 4 s late is still discovered; `crossOriginIsolated` holds in both frames; a single-account wallet skips the chooser.
- **Phase 9:**
  - Confirm re-reads the balance, allowance, fees and `is_paused`, and aborts before signing on any read failure. `is_paused` is re-read again after the Permit2 signature, just before sending.
  - Web Locks keyed by message hash:
    - acquisition does not wait (`ifAvailable`)
    - "already consumed" is re-checked inside the lock
    - the lock is held until the L1 receipt, not just until the tx hash returns
    - this protects cooperating live tabs; the on-chain nullifier is the backstop for crashes
- **Phase 10 (e2e) adds:**
  - the one signed permit names the router, USDC and amount, and its nonce/deadline equal the deposit calldata
  - the wallet swallows the L1 deposit hash → "re-check" finds it by log and claims once
  - the wallet never answers → nothing is found, and discard leaves no pending deposit
  - `CONTRACT_NOT_REGISTERED` → one re-register + resend, with no user-visible error
  - two tabs finish the same exit → exactly one L1 withdraw, and the other tab is told another tab is finishing it
  - a confirm-time read failure → nothing is signed
  - a deposit completes at 390 px and at 1024 px

**Not ported:** the 19 hub `register.nr` tests, the hub keystone and two-token isolation tests, factory/clone ABIs and CREATE2 prediction, register hashes, quoter/route/gas-share, drip, token list, journal/backup/recovery, metadata-reading mocks, owner/sweep/guardian tests (our router is ownerless), and multi-fee-mode cells. Every one of them depends on surface this design does not have.

**Scope impact:** Arc 1 grows the most, with about 10 more Solidity test files + mocks, 14 TXE tests and 5 tooling scripts. Arc 3's harness gets the fault-injection layer. No new runtime dependency is added.

---

## Implementation phases

Every phase: after each meaningful step, run the fast layers (`bun run lint`, `bun run typecheck`, the touched package's tests).

### Arc 1 — contracts

#### Phase 1 — Repo scaffold + keyless testnet probe
- The first commit is `chore: initialize repository` (LICENSE, README stub, `.gitignore` incl. `.env*`); it becomes `main` at Delivery.
- Then the my-stack scaffold:
  - Bun workspaces (`apps/*`, `packages/*`), `bunfig.toml` (min-age 604800, isolated linker), `biome.json` (budgets + `noRestrictedImports` for `@aztec/ethereum`), `tsconfig.base.json` with project references.
  - husky + commitlint + lint-staged, sort-package-json, shellcheck.
  - `AGENTS.md` + `CLAUDE.md` (conventions, `toolchain.json`, the pin rule, the secrets rule), `docs/{roadmap,ci-pipeline,architecture}.md`, `implementations-plan/index.md`.
  - `actionlint.yml`, `.github/actions/setup-toolchains` (reads `toolchain.json`).
- `packages/deployer` skeleton with `preflight.ts`.
- `bun run probe:testnet` is keyless and read-only. It checks:
  - node info equals the expected pins
  - `registry → canonical rollup → inbox/outbox/version` equal node info
  - the SponsoredFPC instance is present, with its Fee Juice balance read and compared against an **estimated fee budget** for Phase 7 (deploy 3 L2 contracts + wiring + 4 smoke legs, from `predictedWorstMinFees` × estimated gas, ×3 headroom)
  - Circle USDC decimals/version
  - Permit2 code present
- `bun run spike:proof-compat` needs **no user-supplied credentials**. It is the plan's **one explicitly authorized key generation**:
  - It creates an ephemeral in-memory Aztec test account (random key, never written, logged or reused; it controls nothing of value).
  - It deploys that account on testnet via SponsoredFPC with **real client proofs** from the JS 5.2.0 stack, spending a small amount of public sponsorship.
  - That proves on day one that the testnet 5.0.0 node accepts 5.2.0 account/client proofs. Bridge-artifact compatibility is still Phase 7's job.
  - The general prohibition stays in force: **no operational deploy or pause key is ever generated**; those come only from the user's `.env.testnet`.
  - On failure, apply the Inference 1 fallback rule (pin JS to the newest 5.0.x that passes) before writing any core code.

**Validation gate** (typecheck/lint + live read-only + live proof):
- Commands: `bun install --frozen-lockfile && bun run lint && bun run typecheck && bun run lint:actions && bun run probe:testnet && bun run spike:proof-compat`
- Pass:
  - all exit 0
  - the probe prints matching identities and a sponsor balance ≥ the estimated budget
  - the spike's account deploy tx is mined on testnet
- If the balance is below budget, **stop and surface**: Inference 2 has failed, and Phase 7 has no fee path.

#### Phase 2 — L1 contracts
- Port `TokenPortal.sol` (V1 + [D19] guards; SPDX + provenance). Write `Permit2DepositRouter.sol` per the Architecture section, plus `MockUsdc`. Remappings via npm + `scripts/gen-remappings.ts`. Foundry pinned to `toolchain.json` (1.7.1).
- Tests: **the full V2 QA port Solidity list**, plus:
  - `WitnessHash.t.sol`: literal typehash + witness vector + mutation tests (each field, chain id, spender, nonce, deadline). The vector is fresh, because V2's 12-field literals don't apply.
  - Sepolia fork suite (`skipIf(!SEPOLIA_RPC_URL)`):
    - a real Permit2 + Circle USDC deposit via the router
    - the portal initialized against the **real testnet registry**, asserting inbox/outbox/rollupVersion equal node info
    - a public deposit landing in the **real Inbox**
- `contracts.yml` CI: the caller + `_contracts.yml` + a status job; hermetic forge, strict halmos, gas snapshot.

**Validation gate** (lint + unit + fuzz/invariant + formal + gas + fork):
- Commands: `bun run test:evm && bun run test:evm:formal && bun run test:evm:gas && SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com bun run test:evm:fork`
- Pass:
  - all green, with `forge fmt --check` included
  - invariants run at `runs=256, depth=500`
  - halmos proves **exactly** the expected proof names/counts, and every canary mutant fails its proof
  - `.gas-snapshot --check --tolerance 2` passes
  - no fork test is skipped when the RPC is set

#### Phase 3 — L2 contracts
- Copy the four crates + `compile.sh`/`run-txe-tests.sh`/`check-sole-consumer.sh` from V1 unchanged, and add **the full V2 QA port Aztec.nr list**. Fix the README prose from 5.0.0 to 5.0.1.
- Add `noir-deps.sh` (fetch → verify only, no compile; the pinned (url, tag, commit) table includes transitive deps) with `--self-test`: empty cache → fetched + verified; modified source → rejected; wrong commit → rejected. Commit the path-scrubbed artifacts.
- Extend `contracts.yml`: clean nargo cache → `noir-deps.sh` → `compile.sh --check` (the sole compile: class-id + ABI parity vs HEAD) → **TXE with the manifest gate** → sole-consumer (self-test first) → keystone. V2 also ran TXE in CI (`_bridge-contracts.yml` `txe` job); V1 did not.

**Validation gate** (lint + unit/TXE + cross-toolchain):
- Commands: `bash contracts/aztec/scripts/noir-deps.sh --self-test && bash contracts/aztec/scripts/noir-deps.sh && bash contracts/aztec/scripts/compile.sh --check && bun run test:noir && bash contracts/aztec/scripts/check-sole-consumer.sh --self-test && bash contracts/aztec/scripts/check-sole-consumer.sh`
- Pass:
  - all exit 0, with a clean `git status` afterwards (`--check` restores the committed bytes)
  - the rebuilt class ids equal the committed ones
  - `run-txe-tests.sh` passes its manifest gate: every `txe-manifest.txt` name passes, and the count is ≥ the floor
  - keystone literals equal the `ContentHash.t.sol` literals

**Arc 1 boundary:** codex loop (Post-implementation), then `git switch -c usdc-bridge-core`.

### Arc 2 — core, harness, testnet

#### Phase 4 — `bridge-core`
- Copy verbatim: `content-hash`, `claim-secret`, `l2`, `l1-receipt`, `progress`, `status` + tests.
- Adapt:
  - `permit2.ts`: witness + typed data + mutation tests against the Solidity literals.
  - `deposit.ts`: `prepareDeposit`/`submitDeposit`/`reconcileDeposit`; `ensurePermit2Allowance`; mined-log parsing.
  - `claim.ts`: `waitClaimable` + `claim`, with the sponsored payer for private claims, the informed fallback, and "already consumed".
  - `exit.ts` / `withdraw.ts` / `outbox.ts`: viem `getRoots` reader; message located by content; `exitTicketFromTx`.
  - `fees.ts`, `manifest.ts` (zod-strict, the single definition), `network.ts` (`assertNetworkIdentity`, `assertSigningContext`), `errors.ts` (`retryOnUnregistered`, `isUserRejection`, `humanizeWalletError`), `artifacts.ts`.
- Unit tests (fake viem transports):
  - wrong chain/account → refuse
  - reverted receipt → throw with the draft intact
  - receipt timeout → draft keeps `l1TxHash`; `reconcileDeposit` finds the mined event and never re-sends
  - **lost wallet response (broadcast, no hash)** → the log scan finds it by depositor + secretHash
  - a replaced (sped-up) tx whose **original hash is known** → the hash lookup fails, the log scan still runs and finds it
  - a deposit **re-mined below the pre-send tip** after a reorg → found, because `fromBlock` is the pre-send finalized block
  - a log from a non-router address → ignored; **exactly one** router `Deposit` log per receipt, so a same-signature log emitted by the token during the pull cannot redirect recovery
  - `walletChainIdOf` pinned to testnet `1816023401`, never equal to the bare rollup version
  - `exitToL1` refuses a zero or portal `recipientL1` before any wallet call (no burn happens)
  - ABI pins (router, portal) and class-id pins, reading artifacts lazily inside `it()`; one mutation test per TS mirror of an on-chain rule
  - "not-deposited" is returned only after a complete scan through a finalized block with timestamp > deadline; an RPC error mid-scan → "pending"
  - event parsed from mined logs
  - message lookup: mismatch → reject; picks the right index among several
  - `exitTicketFromTx`:
    - two identical occurrences, first consumed → selects the second
    - all consumed → "all-consumed"
    - wrong recipient/amount → "not-found"
  - witness construction: root mismatch → bounded rebuild; missing root → "pending" (exercising the real stdlib helper against a fake roots reader)
  - manifest rejects unknown/missing fields
  - the retry fence
  - unsupported wallet method / disconnect → retryable error with the draft kept

**Validation gate** (lint + typecheck + unit):
- Commands: `bun run lint && bun run typecheck && bun test packages/bridge-core`
- Pass: exit 0; the three cross-toolchain vector tests assert the same literals as Solidity/Noir.

#### Phase 5 — `local-network` + `deployer`
- Port the freeze `local-network.ts`:
  - native `anvil` + `aztec start --local-network` from `~/.aztec/versions/${toolchain.aztecNode}` (5.0.0)
  - ports from `~/.agents/ports.md`
  - detached spawn, teardown by owned pgid
  - datadir `~/.cache/inference-money/net/<runId>`
  - attach mode via `NET_L1_RPC` + `NET_NODE_URL`
  - a block heartbeat (force a block every 3 s while tests run): the local network only builds blocks on txs, so L1→L2 readiness never advances otherwise
- Also port `handle.ts`.
- Deployer:
  - `deploy-l1.ts`: viem + forge artifacts. Local: Permit2 via `anvil_setCode` at the canonical address, and `MockUsdc`.
  - `deploy-l2.ts`: aztec.js, **deployer-bound** instances, SponsoredFPC fee payment.
  - `verify.ts`: the full list in Architecture, against a fresh `forge build --force` (a stale or missing `out/` fails, never skips).
  - `manifest.ts`, `secrets.ts` (`.env.testnet` 0600 loader + scrubbed child env + boolean scanner).
  - CLI: `net:up|down|status`, `deploy:local`, `verify:local`.

**Validation gate** (lint + unit + run-isolation):
- Commands: `bun test packages/local-network packages/deployer && bun run net:up && bun run deploy:local && bun run verify:local && bun run net:down`, run twice concurrently (`RUN_ID=a` / `RUN_ID=b`) from two shells.
- Pass: all exit 0; `verify:local` passes every read-back including the bytecode match and the owners; the concurrent runs get disjoint ports and each reaps only its own pgids (checked via `~/.agents/ports.md` + `ps`); nothing owned is left afterwards.

#### Phase 6 — Integration suite (`packages/integration`)
A per-run local network (node 5.0.0) + deploy in global setup. Specs:
1. Public deposit → `claim_public` → L2 public delta.
2. Private deposit → `claim_private` (sponsored; the tx's fee payer asserted == SponsoredFPC) → L2 private delta.
3. A private claim naming another recipient fails to consume; the same relayer then submits it for the right recipient and it lands.
4. Double claim → "already-consumed".
5. Public exit → proven → L1 withdraw → L1 delta; the Outbox reads not-consumed before the withdraw and consumed after.
6. Private exit (sponsored, payer asserted) → withdraw.
7. Destroy all app memory after a private exit to a **non-default** recipient, then `exitTicketFromTx(hash, recipient, amount)` → withdraw.
8. L1 withdraw replay reverts.
9. Attacker-first L2 initialization of a fresh deployer-bound proxy/bridge fails.
10. Receipt timeout (injected) → `reconcileDeposit` → claim succeeds, with exactly one deposit on L1.
11. **Broadcast then lost wallet response** (the L1 wallet shim drops the hash) → reconcile via log → claim, with exactly one deposit.
12. **Two identical exits in ONE L2 tx** (a batched wallet call). Withdraw the first. Clear app memory. `exitTicketFromTx` selects the second (unconsumed) occurrence and withdraws it. A third attempt → "all-consumed".
13. An unfunded sponsor → a clear error, with the ticket kept.
14. Network-identity mismatch → refuses before signing.
15. [D20] Owner pauses the bridge → a new deposit is refused before signing, and an in-flight deposit's claim fails with "Bridge is paused". Unpause → that claim lands.

**Validation gate** (integration — execution/API compatibility; proof acceptance is covered by Phases 1 and 7):
- Commands: `bun run test:integration`
- Pass: all specs green against node 5.0.0 with JS 5.2.0 (or the fallback pin, applied and logged); no owned processes left.

#### Phase 7 — Testnet deploy + Node smoke
- **Precondition:** `.env.testnet` exists with mode 0600 (provisioned), and the L1 address holds ≥ 5 Circle Sepolia USDC (user funds it). If either is missing, surface and hold. Never create or rotate operational keys autonomously.
- The deploy and smoke use ephemeral wallets/PXEs only. `probe:testnet` re-checks that the sponsor balance is at or above budget immediately before spending.
- Commit `deployments/testnet.json`. Pass the user the pause-key reminder (accepted: they keep the key).

**Validation gate** (e2e-live-network, real proofs):
- Commands: `bun run probe:testnet && bun run deploy:testnet && bun run verify:testnet && bun run smoke:testnet && bun run secrets:scan`
- Pass:
  - all exit 0; the manifest passes schema + verify
  - the smoke settles all four legs (public deposit → claim, private deposit → claim with the sponsored payer asserted, public exit → withdraw, private exit → withdraw) at ≤ 1.25 USDC per leg with the expected deltas, `provenTimeoutSec ≥ 3600`
  - `secrets:scan` reports `false`
  - no wallet/PXE data dir exists on disk after teardown

**Arc 2 boundary:** codex loop, then `git switch -c usdc-bridge-web`.

### Arc 3 — web

#### Phase 8 — App scaffold + wallet layer + e2e harness (connect spec)
- Vite + React 19 + TS strict + Tailwind v4 (`@tailwindcss/vite`, `@theme`) + shadcn/ui + `tailwind-variants`. Placeholder look (neutral palette, name "USDC Bridge"). The network config embeds the manifest at build time, with no prod override.
- **L1:** wagmi 3 + injected connector, `unstable_connector(injected)` transport, chain guard.
- **Aztec session:** port `createAztecWalletSession.ts` to an external store + `useSyncExternalStore`, covering discovery (1 s ambiguity window, anti-spoof), picker, emoji verification, capabilities, account chooser and registration.
- **Capability manifest:** scoped grants from V1's **combined** manifest, trimmed to USDC: `claim_public`/`claim_private`/`exit_to_l1_*`/`burn_*` on the right contracts, balance simulations, claim simulations, `STANDARD_AUTH_REGISTRY_ADDRESS.set_authorized`, `sponsor_unconditionally`.
- **Headers:** COOP/COEP/CSP/frame-ancestors via `public/_headers` + Vite dev/preview; `wrangler.jsonc`.
- **E2E harness:** port the freeze design:
  - `agent.sh` + `resolve-ports.ts` (ports → net:up + deploy:local → builds → assert bundles name the node → Playwright → reap)
  - `test-wallet/` (embedded `@aztec/wallets` behind the wallet-sdk handler, **with capability enforcement** that rejects ungranted calls). Fault injectors (`failNext`/`holdNext`/`swallowNext`/`dropNext`, matched by target) and `declineNextGrant`. One origin per profile. The `detect-node` tripwire + a Node JSON-import hook.
  - `fixtures/l1-wallet.ts` targeting `window.ethereum`: `rejectNext`/`holdNext`/`swallowNext`, per-method call counts, captured Permit2 signatures, chain/account-change events
  - `fixtures/egress.ts` as an auto fixture that asserts zero blocked requests on every test
  - deterministic actors seeded in Node and injected only into the wallet origin; worker-scoped pools with retry spares
  - spec `connect.spec.ts`:
    - discovery → emoji → grant → account
    - L1 connect through wagmi
    - `crossOriginIsolated === true` in both frames
    - a wallet frame loading 4 s late is still discovered
    - a single-account wallet skips the chooser
- CI: `web.yml` + `bridge-core.yml`.

**Validation gate** (lint + typecheck + component + e2e smoke):
- Commands: `bun run lint && bun run typecheck && bun run --cwd apps/web test:components && bun run --cwd apps/web build && bun run test:e2e -- connect.spec.ts`
- Pass: exit 0. Session store tests cover stale-flow discard, the duplicate-id anti-spoof path, grant parsing (bidi/length caps), and 1 vs many accounts. The connect spec passes (Inference 8 proven).

#### Phase 9 — Bridge UI
- **Direction toggle.** L1 → L2 / L2 → L1.
- **Deposit form.** 6 dp amount validation, and a public/private switch with privacy copy: "hides **who** receives, not **how much** or **when**". The Permit2 approval step carries the unlimited-approval risk note. The review screen shows exact values. The draft is created before signing, with a stepper (approve → sign → L1 confirmed → message ready → claim → done) and "keep waiting / re-check" on receipt trouble.
- **Withdraw form.** Recipient defaults to the connected L1 account. Stepper: exit → proving progress → L1 withdraw → done.
- **"Finish a withdrawal"** form: L2 tx hash + L1 recipient (defaults to the connected account) + amount. The form explains that all three must match the original exit.
- **Balances** on both chains.
- **Guards and fallbacks.** Deposits are refused while the bridge's `is_paused` slot is set, and the unclaimed-deposit screen shows paused copy (accepted risk 4). A `beforeunload` guard while a deposit is unclaimed, the informed fee fallback dialog, and the "already claimed/withdrawn" states. The withdraw form refuses the portal (and zero) as the L1 recipient.
- **Confirm-time reads.** Confirm re-reads the balance, allowance, fees and `is_paused` fail-closed before signing, and re-reads `is_paused` after the Permit2 signature, before sending. A pause after that final read stays accepted risk 4.
- **Single submission.** Withdrawal submission sits under a Web Lock keyed by message hash:
  - non-waiting acquisition
  - "already consumed" re-checked inside the lock
  - the lock held through the L1 receipt
- **Copy review.** Plain language, no jargon.

**Validation gate** (lint + typecheck + component):
- Commands: `bun run lint && bun run typecheck && bun run --cwd apps/web test:components && bun run --cwd apps/web build`
- Pass: exit 0. Component tests cover:
  - amount validation
  - private mode never putting the recipient in the witness/tx
  - the draft existing before `signTypedData` is called
  - beforeunload registration/unregistration
  - fee fallback requiring explicit confirmation
  - a confirm-time read failure → nothing signed
  - a pause landing during the wallet prompt → the send is refused after signing
  - the withdraw form refuses the portal as the recipient
  - the Web Lock is held across the "hash returned, not yet mined" interval
  - stepper transitions from a fake core

#### Phase 10 — Full e2e + testnet build
Specs:
- public deposit → claim
- private deposit → claim, where the test wallet's submitted payer == SponsoredFPC (**mandatory** locally)
- public exit → withdraw
- private exit → withdraw
- finish a withdrawal from a tx hash
- L1 signature rejection → recoverable
- an ungranted call rejected by capability enforcement surfaces a humanized error
- the one signed permit names the router, USDC and amount, and its nonce/deadline equal the deposit calldata
- the wallet swallows the deposit hash → "re-check" finds it by log and claims once; the wallet never answers → nothing is found, and discard leaves no pending deposit
- `CONTRACT_NOT_REGISTERED` → one re-register + resend, with no user-visible error
- two tabs finish the same exit → exactly one L1 withdraw tx, and the other tab says another tab is finishing it
- a deposit completes at 390 px and at 1024 px viewports

Each spec carries its `docs/assurance-map.md` cell id.

Also:
- `build:testnet` embeds `deployments/testnet.json`; a test asserts the embedded manifest equals the committed file.
- `_e2e.yml` reusable workflow (`workflow_dispatch` + `e2e` label).

**Validation gate** (e2e):
- Commands: `bun run test:e2e && bun run test:e2e && bun run --cwd apps/web build:testnet`
- Pass: all specs green on two consecutive runs; zero egress violations; no owned processes left; the testnet build succeeds with the manifest identity check.

**Arc 3 boundary:** codex loop.

---

## Decision ledger

| # | Decision | Chosen | Rejected (why) | Source | Status |
|---|---|---|---|---|---|
| D1 | Port base | V1 `4df5eae5` minus fuel | genesis `54708390` (no Permit2/recipient commit); V2 (different product) | recon | settled |
| D2 | Outline | A + audit fixes | B: saves a contract, not an authority; inconsistent ("no owner" + owner-gated setter); drops TXE/red-team lineage and the incident lever | codex + fable | settled |
| D3 | A-1 fix | immutable PORTAL/TOKEN; constructor rejects an uninitialized portal | allowlist; V2 factory lookup | recon, fable M7 | settled |
| D4 | Router owner | none | Ownable2Step + sweep | main; both audits "looks right" | settled |
| D5 | Private-op fee payer | request SponsoredFPC; explicit informed fallback; payer asserted in tests | wallet default (#554 leak); block when unproven (no pre-submission signal from third-party wallets) | codex H3, fable, user "best effort" | settled |
| D6 | Persistence | none; in-memory draft before signing (with a pre-send submission record); exit resume by tx hash + recipient + amount; beforeunload | minimal pending store (declined by user) | user; codex H2 + final H1/H2; fable M6 | settled (resume form + guard included, Ask 3) |
| D7 | Deposit authorization | Permit2, unlimited approval | EIP-2612 exact (recommended, declined); Permit2 exact (2 txs + sig/deposit); both (surface) | user after codex M7 / fable M2 | settled |
| D8 | L2 deploy mode | deployer-bound | universal (initializer takeover) | codex H1, fable H1 | settled |
| D9 | Compatibility proof timing | Phase 1 keyless probe + **keyless real-proof spike** (ephemeral account via SponsoredFPC) + Phase 2 fork vs real registry/Inbox + local node 5.0.0 (execution/API) in Phase 6 + testnet smoke (real proofs) in Arc 2 | Phase-10-only (late); a full-stack spike before contracts (needs the contracts; the account-deploy spike covers proof acceptance) | codex H4 + final M4, fable H2 | settled |
| D17 | Exit recovery inputs | tx hash + recipient + amount, verified against the recomputed message | hash-only (impossible: messages are hashes); a contract recovery event (changes red-teamed L2 code) | codex final H1 | settled |
| D18 | Lost-response deposits | pre-send submission record + bounded router-log scan by depositor + secretHash; permit deadline bounds ambiguity | hash-only reconciliation (misses broadcast-then-disconnect) | codex final H2 | settled |
| D19 | Portal guards | add V2's u128 cap, exact-transfer deltas (pull + payout) and `nonReentrant` to `TokenPortal`, all outside the hash preimage | verbatim canonical + F-001 only (the router's checks don't cover direct callers; silent insolvency if USDC ever takes a fee) | V2 QA port (Solidity sweep, driver-verified in V2 source); user | settled |
| D20 | Pause scope | claims + exits (V1 verbatim); refuse new deposits while paused (accepted risk 4) | exits only (V2; recommended by the driver because a claims pause can destroy in-memory deposits) | user override | settled |
| D21 | Noir artifact gate | `compile.sh --check` as the sole compile: class-id parity **plus** normalized SDK-facing ABI parity against the HEAD-committed artifacts; a mutated-name regression | byte-level `git diff --exit-code` (false-reds on non-semantic JSON noise); class id alone (misses public ABI corruption — codex r4 M1) | V2 QA port; codex r4 M1/M2 | settled |
| D22 | TXE in CI | yes, behind the manifest gate (committed `txe-server/`, 2 threads), as V2's final CI did | local-only (V1; an unenforced manifest is a suggestion) | V2 QA port; codex r4 L6 correction | settled |
| D23 | V2 QA port | adopt the filtered list (§ V2 QA port) | port V2 wholesale (factory/hub/fuel surface absent); keep V1's QA (user asked for V2-grade) | user request + 3 sweeps | settled |
| D10 | viem | canonical only; viem outbox reader; import ban | dual viem + `L1Port` seam | fable M3, codex (untyped seam) | settled |
| D11 | Integration location | `packages/integration` | inside bridge-core (dependency cycle) | fable M4 | settled |
| D12 | L1 transport | injected connector only | public RPC `http()` (egress leak) | fable M5 | settled |
| D13 | Toolchain | node 5.0.0 / JS 5.2.0 / Noir 5.0.1 via `toolchain.json` | Noir 5.2.0 (testnet is 5.0.0) | recon | settled (Inference 1 fallback rule) |
| D14 | Arcs | 3 (contracts → core+testnet → web) | 4 (testnet last = late compat proof); 2 (B) | codex H4 | settled |
| D15 | DS string | keep `nulo_…` | rename (re-pins 3 toolchains) | main | settled |
| D16 | `/harden` | contracts only, after all arcs, before PRs | at the Arc 1 boundary (recommended; user chose the end) | user | settled |

### Audit log — adopted vs rejected

**Codex r1 (reject)**. All findings are adopted except as noted:
- H1 → D8.
- H2 → D6 / `DepositDraft`.
- H3 → D5.
- H4 → D9/D14. The separate pre-port spike was rejected; the early probe + fork + local-5.0.0 cover it.
- M5 → full verification.
- M6 → privacy copy.
- M7 → attack taxonomy. Exact approval as default was **rejected by the user** (D7).
- M8 → combined-manifest grants + enforcing test wallet.
- M9 → message lookup.
- M10 → pre-compile deps check + in-process secrets.
- L11 → invariant phrasing, mandatory halmos, mutation tests.
- The Assumptions corrections (exit recoverability; "provenance, not proof") are adopted.

**Fable r1 (conditional approve)**. Conditions (1) deployer-bound + owner read-back, (2) Phase 1 probe + an explicit L2 fee path, (3) drop `@aztec/ethereum` + break the cycle and (4) privacy/Permit2 corrections are **all adopted**. Other findings:
- M5 → D12.
- M6 → exit resume.
- M7 → router constructor check.
- L1–L9 adopted (isValid, `initializer`/`publicKeys` in records, SPDX, 30-min deadline, pause-key custody, 0600 key file, relayer tagging note, `window.ethereum` targeting, invariant phrasing).
- Modified: the "bundle has no `@aztec/viem`" assertion was replaced by an import ban, because aztec.js may pull it transitively.
- recon fact typo (`7bdbd8a2` → `6b07138b`) fixed.

**Codex final fresh pass r1 (reject: incomplete deposit reconciliation; unsupported hash-only private-exit recovery)** — session `01a0d999-cad9-72c0-aa60-29ba08de9949`. All findings adopted:
- H1 → D17.
- H2 → D18.
- M3 → fetch/verify/compile `noir-deps.sh` + self-tests.
- M4 → execution vs proof compatibility split, plus the Phase 1 real-proof spike (D9).
- M5 → ephemeral wallets/PXEs + scanner scope + dummy-secret tests.
- M6 → the mandatory redeploy/re-smoke/rebuild chain when `/harden` changes bytes.
- M7 → occurrence index + stdlib witness helper + identical-exit and root-mismatch tests.
- L8 → transport wording + unsupported-method/disconnect tests.
- Assumption fixes: time-sensitive facts flagged; budget-based sponsor check; D6 status corrected.

**Codex final pass r2 (reject: reconciliation can falsely declare a mined deposit absent)** — same session, resumed. All findings adopted:
- H1 → finalized-block lower bound; always scan when the hash lookup doesn't establish the deposit; "not-deposited" only after a complete scan through a finalized block whose timestamp is past the deadline, with RPC errors → pending; reorg + known-replaced-hash tests.
- M2 → an occurrence selection rule (explicit index or the first unconsumed) + `"all-consumed"`/`"not-found"` outcomes + a same-tx duplicate test.
- M3 → a bounded rebuild around witness **construction**, with a missing root → pending.
- M4 → the spike key is explicitly authorized and scoped, and the operational-key prohibition is kept in the plan + seed.

**Codex final pass r3: `approve`** — no remaining material findings. Residual risk lives in the validation gates (mixed-version bridge compatibility, sponsor funding, wallet fee behavior).

**Codex final pass r4 (reject; v5 delta)** — same session, resumed. All findings adopted:
- M1 → class-id **plus** SDK-facing ABI parity, with a mutated-name regression (D21).
- M2 → `noir-deps.sh` fetches and verifies only; `--check` is the sole compile, against HEAD.
- M3 → `exitToL1` refuses zero/portal recipients before the burn; the payout check is documented as portal-debit.
- L4 → `is_paused` is re-read at confirm and after the Permit2 signature.
- L5 → the Web Lock lifetime is specified.
- L6 → the D22 premise is corrected (V2 ran TXE in CI).

**Codex final pass r5: `approve`** — all six r4 fixes are consistent, with no new contradiction.

**Disagreements:** D20. The driver recommended an exits-only pause; the user kept V1's claims + exits pause, which is recorded as accepted risk 4. The unlimited-Permit2 vs EIP-2612 tension was also decided by the user, and is listed under Deferred to mainnet.

---

## Post-implementation

`code_review` is `off`: `/code-review` is **not** run. The loops run per arc at each boundary (Arcs 1–3), then a final cross-arc pass, then `/harden`, then Delivery.

1. **Codex audit (per arc)** — `/codex high` (GPT-6 Astra, `high`) with:
   - the arc's diff (`git diff <arc-base>..HEAD`)
   - this plan.md + Decision ledger
   - the arc map: "arc N of 3: 1 contracts → 2 core/local-network/deployer/integration/testnet deploy → 3 web/e2e; later arcs build X on it"
   - the adversarial/security ask: "What could go wrong? What would an attacker target? What are we trusting that we shouldn't? Where are the supply-chain / crypto / least-privilege weaknesses?"
   - both rules below, verbatim.
2. **Iterative fix loop**:
   - Verify codex's factual claims against the repo, then apply the accepted fixes and commit.
   - Log the round (consult + verdict) in `implementations-plan/usdc-bridge/lessons/phase-N.md`.
   - **Resume the same codex session** with the fix diff for a re-review.
   - Repeat until a round yields no new material findings (rejected nitpicks don't count).
   - Still material after 3 rounds → stop and surface to the user.
3. **Final cross-arc integration pass**: a FRESH codex session over the net diff from the root commit, with the cross-arc ask (seams between arcs, duplication across arcs, drift from this plan) and both rules. Same loop.
4. **`/harden security` scoped to `contracts/`** (user decision). Remediate findings on the top arc (or on Arc 1 by local rebase while branches are unpublished), committing separately. Then resume the final-pass codex session with the remediation diff until clean. Contract changes that move a pinned literal must update all three toolchains in the same commit.

   **If remediation changes any deployed bytes or contract identity**, the following are mandatory, not optional:
   - recompile + re-run Phases 2–3 gates
   - `deploy:testnet` + `verify:testnet` + `smoke:testnet` again
   - commit the refreshed `deployments/testnet.json`
   - re-run `test:integration` and `test:e2e`
   - `build:testnet`

   Before Delivery, `verify:testnet` must pass against the **final** artifacts.
5. **Delivery** — the first time any PR is opened.

**No-over-engineering rule** (verbatim in every codex prompt): *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."*

**Comment-quality rule** (verbatim in every codex prompt): *"Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."*

---

## Delivery

| Arc | Branch | Phases | Stacks on | `/code-review` |
|---|---|---|---|---|
| 1 contracts | `worktree-usdc-bridge` | 1–3 | `main` (root commit) | off |
| 2 core + testnet | `usdc-bridge-core` | 4–7 | arc 1 | off |
| 3 web | `usdc-bridge-web` | 8–10 | arc 2 | off |

- **During implementation:** arcs are local branches (`git switch -c` at each boundary). Pushing branches to checkpoint is allowed; there is no PR, so no CI runs.
- **Delivery (after every loop + `/harden` converge):**
  1. `git push origin <root-commit-sha>:refs/heads/main`.
  2. `gh stack init --base main worktree-usdc-bridge usdc-bridge-core usdc-bridge-web`.
  3. `gh stack submit --auto`.
  4. `gh pr edit` each body.
  5. `gh pr checks --watch`.
- `gh stack merge` is the user's call.
- Update `implementations-plan/index.md`; suggest `agent-worktree done usdc-bridge` after merge.

---

## Seeds

ELI5 companion: Artifact https://claude.ai/artifact/283yftTmVtW6JGRQytKYPo (source: `implementations-plan/usdc-bridge/eli5.html`; republish that file to update the same URL).

Finalized 2026-09-25 on the user's go-ahead (they asked for the /goal after reviewing v5).

```
/goal All phases marked ✓ in implementations-plan/usdc-bridge/plan.md (the per-phase headers in the file — not the chat, not the task list), each ✓ backed by its phase's validation gate (as defined in plan.md) reported passing in the transcript; for each phase the agent has printed `LESSONS_FILE=implementations-plan/usdc-bridge/lessons/phase-N.md` in the transcript; plan.md's `code_review` is `off`, so `/code-review` was NOT run; the codex fix loop converged for EVERY reviewed diff — each of the 3 arcs at its boundary plus the final cross-arc pass — each convergence evidenced by a resumed codex pass reporting no new material findings, quoted in the transcript; `/harden security` scoped to contracts/ ran after the final pass with findings remediated and re-reviewed; the Delivery section's 3-PR stack exists on GitHub, created only AFTER all loops converged (`gh stack view` output in the transcript); if /harden changed contract bytes, the Post-implementation redeploy → verify → smoke → rebuild chain ran and passed; `bun run test && bun run test:evm && bun run test:evm:formal && bun run test:evm:gas && bun run test:noir` and `bun run lint && bun run lint:actions && bun run typecheck` both report exit 0 in the transcript.
```

```
/loop 15m Drive implementations-plan/usdc-bridge forward. Never idle waiting for my input. Each firing:
1. Reality check: read implementations-plan/usdc-bridge/plan.md and lessons/ (authoritative state — not the chat); native task list empty? rebuild it from plan.md, one task per remaining step; run `git status` and `git log --oneline -5`. If PRs exist, `gh stack view`.
2. Waiting on a long local run (integration/e2e/testnet proof) is fine — confirm it is progressing (owned process group alive, log advancing); use the wait to review the diff or strengthen tests; don't start conflicting work. Long runs go in tmux (machine rule).
3. No task in hand? Pick the next pending step from plan.md and start it. After each meaningful edit run `bun run lint && bun run typecheck` + the touched package's tests. Commit (conventional, signed) → push the arc branch.
4. Stuck, or facing a decision you'd normally bring to me? Call `/codex high` with full context, reach a defensible decision, act, and log consult + verdict in lessons/phase-N.md. Hard limits stay hard: never merge, never deploy anything but the plan's testnet deploy, never create/print/persist secrets (the sole exception: Phase 1's ephemeral in-memory spike account, as plan.md scopes it; Phase 7 waits for my `.env.testnet`), never expand scope beyond plan.md.
5. Same step failed 5 times? Stop retrying; reassess with codex, continue down the agreed path.
6. Phase green = its plan.md validation gate passes: run it, paste the result, mark ✓ in plan.md, write lessons, print `LESSONS_FILE=implementations-plan/usdc-bridge/lessons/phase-N.md`, `agent-worktree status usdc-bridge "phase N green: <next>"`. Arc boundary? Run the arc's codex loop (plan.md Post-implementation, both verbatim rules) until clean; THEN `git switch -c <next-arc-branch>`.
7. All phases ✓? Final cross-arc codex pass (fresh session, net diff from the root commit, cross-arc ask + both rules) until clean; then `/harden security` on contracts/, remediate, re-review; then Delivery per plan.md (push root to main, `gh stack init --base main …`, `gh stack submit --auto`, PR bodies, `gh pr checks --watch`). Then write the wrap-up: what shipped, every contentious decision with ELI5 context, open items. Surface and stop.
Keep the native task list current (TaskUpdate); plan.md stays the source of truth.
```
