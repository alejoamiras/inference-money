# Phase 11 — Re-pin to Aztec 6.0.0-rc.1

Status: **done** (gate green, codex loop converged).

## What changed

- **Pins.** `toolchain.json`: node, JS and Noir `6.0.0-rc.1`, nargo `1.0.0-rc.3`; Foundry stays `1.4.1` (v6's install manifest pins it).
- **npm.** 89 files move from `@aztec/*` to `@aztec-labs/*` (SDK) or `@aztec-foundation/*` (bb.js, noir-*, l1-artifacts, aztec-standards, wsdb, bb-avm-sim), all exact `6.0.0-rc.1`, in the workspace and both toolchain packages. `foundry.toml` keeps the `@aztec/` Solidity import prefix and remaps it into `@aztec-foundation/l1-artifacts`. The only `@aztec/` left in the lockfiles is `@aztec/viem`, the SDK's own viem alias.
- **Release-age gate ([D27]).** Bun's `minimumReleaseAgeExcludes` takes exact names only: `@aztec-labs/*` is silently ignored. The lists (root 42 names, each toolchain 60) were grown by an install loop until the install resolved.
- **Noir ([D28]).** aztec-nr from `aztec-labs-eng/aztec-nr`, the token from `AztecProtocol/aztec-standards`, and `token_portal_content_hash_lib` from `aztec-labs-eng/aztec-node` (gone from aztec-packages in v6), all at `v6.0.0-rc.1`. `noir-deps.sh` pins each tag's commit, verified independently through the annotated tag objects.
- **nargo.** The noir-lang release asset is renamed `noir-x86_64-unknown-linux-gnu.tar.gz`, and its members are prefixed `./` (plus noir-execute, noir-profiler, noir-inspector), so `setup-toolchains` extracts `./nargo`. New pin file `nargo-1.0.0-rc.3.sha256`; `nargo-5.sh` is now `nargo.sh`.
- **Artifacts.** Rebuilt through `compile.sh`. New class ids: TokenBridge `0x2e9ade2e…96a3`, TokenMinterProxy `0x18d06d3b…af94`, Token `0x24c34002…1505`.
- **5.x compat removed.** v6 SponsoredFPC is a v6 class, so the legacy HandshakeRegistry hook, `compat.ts` and the vendored 5.0.0 artifacts go. The sponsor artifact comes from `@aztec-labs/noir-contracts.js/SponsoredFPC`; salt 0 derives `0x06a9fa02…924b` (class `0x2f85ee9e…f433`), which v6 testnet has.
- **Claimability.** v6 dropped `getL1ToL2MessageCheckpoint`. `isClaimable` now asks for `getL1ToL2MessageMembershipWitness("latest", …)`, defined once the message sits in a committed block's tree; `getL1ToL2MessageIndex` answers at L1 ingestion, too early.
- **Testnet pins.** Rollup `2914217885`, the new Inbox, Outbox and fee-juice portal, the v6 sponsor, and the dRPC URL as public config ([D29]).

## Attempts

1. **Blocked optional packages.** TXE failed with "aztec-wsdb binary not found": bun skips a blocked optional dependency without a word. Adding the eight `@aztec-foundation/{wsdb,bb-avm-sim}-<platform>` names was not enough on its own, because the lockfile had already resolved their parents without them; dropping the two parent entries forced a re-resolve. TXE then passed 48 + 8.
2. **Standard contracts still needed.** A v6 local network seeds only AuthRegistry, and v6 testnet has none of AuthRegistry, PublicChecks and HandshakeRegistry. `ensureStandardContracts` stays; on testnet the deploy will publish all three.
3. **Deployer account "not deployed" on a reused network.** v6 account deploys skip instance publication by default (`deploy_account_method.js`: `skipInstancePublication ?? true`), so `node.getContract(account)` never finds the account and a second deploy against the same network hit "Existing nullifier". `ensureDeployerAccount` now reads the wallet's `initializationStatus` (the initialization nullifier).
4. **`compile.sh --check` before commit.** It compares against HEAD's artifacts, which are still 5.x until the rebuild is committed. v6 stdlib cannot parse their storage export (`storageExport.kind`), so the check reports drift until then; rerun after committing.
5. **Brillig coverage warnings.** Every "Brillig call … not sufficiently constrained" warning sits in aztec-nr (`history/storage.nr`, `context/returns_hash.nr`, `oracle/get_contract_instance.nr`, …). Our `src/main.nr` appears only as the caller in their call stacks.
6. **A dropped proxy deploy on the first reused network (unexplained).** On `v6a`, after the first attached run hit the account bug, the second attached run's proxy deploy was accepted by the node and then failed in the block builder with 0 gas ("Tx dropped by P2P node"). Two follow-ups did not reproduce it: two `deploy:local` runs on one fresh network (`v6b`), then the attached suite on that reused network (16/16). A tx-expiry theory does not fit: `MAX_TX_LIFETIME` is 86400 s, and the time warp was about 19 min. Revisit if it recurs.
7. **The web claim answered at a proposed block (found by CI e2e, after the gate).** On the CI runner, the public-deposit spec ended on "This deposit was already claimed." instead of "Done": the funds had arrived exactly once. The Playwright trace's node calls show the sequence:
   - the claim receipt is `proposed` (block 44; checkpointed tip 43);
   - the flow's `checkpointed` nullifier read misses, so it judges the claim "dropped", re-claims, and gets "already nullified".
   - **Cause.** v6's wallet-sdk `WaitOptsSchema` has no `waitForStatus`, and zod strips unknown keys. The app's `wait: L2_DONE` therefore reaches the iframe wallet without its status, and `EmbeddedWallet` then defaults to `PROPOSED`. In-process wallets (deployer, integration, smoke) pass the option directly and were never affected. Locally a block is checkpointed almost at once, which hid it.
   - On testnet a checkpoint takes up to a 72 s slot, so most web claims would have hit the same spurious re-claim.
   - **Fix.** `claim()` sends with `NO_WAIT` and waits for `CHECKPOINTED` on the node itself, as exits already did. The new unit test feeds a proposed-then-checkpointed receipt and fails on the old code.
   - Deployed bytes are unchanged, so the testnet deploy stands. The smoke's claims ran in-process, where the wait was always honoured.
   - This was the first CI e2e run: `web.yml` runs it on the `e2e` label, which does not exist in the repo, so it ran here through a manual dispatch.

## Validation

- Unit: bridge-core 120, deployer 29, local-network 14, web 93 + 1 skipped, contracts 2 + 1. Lint, typecheck and actionlint are clean.
- Forge unit/fuzz/invariant 64, gas snapshot, halmos 8/8. TXE: token_bridge 48, keystone 8.
- `compile.sh --check` against the committed v6 artifacts: clean.
- Integration on its own network (`it-2888562`): 16 pass, 356 s. Attached to the reused `v6b` network: 16 pass, 328 s. Teardown is clean.
- `probe:testnet`: 18/18.
- e2e, two consecutive runs: 18 passed (8.6 min), then 18 passed (8.7 min). No registry rows or owned processes are left.

## Codex loop

### Round 1 — session `01a0ef33-1f6a-7f53-9d6c-5148519b365f` (GPT-6 Astra, high), on `640b4af`

Verdict: **No new material findings.** It confirmed:
- the Noir cache pins, lockfile integrity and the exact-name exclusion lists;
- the bridge invariants (content hash, recipient binding, sole consumer, pause, initializer binding) and the Outbox interface;
- that the witness check is stronger than the old assigned-checkpoint lookup;
- the deployer-account fix.

It also raised three Low comment fixes. All three were accepted:
- `claim.ts`: `"latest"` is a proposed block, not a committed one, so both claimability comments now say that.
- The three bunfigs dropped their `(D27)` plan reference.
- The keystone secret-hash comment is down to one line.

### Round 2 — resumed on `46bd716`

Verdict: **No new material findings.** The three comment fixes are accurate, and no further issue was found in the re-pin. The loop has converged.
