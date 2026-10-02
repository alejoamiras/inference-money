# Recon: galactica-compliant-usdc

Base: `origin/main` @ `798682b` (2026-09-30), the worktree's own base. Three read-only agents mapped it: contracts, app/tooling, and one batched reuse sweep. Every line reference below was re-checked in the worktree.

## Reuse map

| # | Capability needed | What exists | Verdict |
|---|---|---|---|
| C1 | Private deposit bound to its L1 depositor (L1) | `TokenPortal.depositToAztecPrivate(uint256,bytes32)` (`contracts/evm/src/TokenPortal.sol:109`), content `mint_to_private(uint256)`. The router knows the signer (`Permit2DepositRouter.sol:40` emits it) but never passes it: inside the portal, `msg.sender` is the router | adapt (breaking message format) |
| C1 | Same, L2 side | `token_portal_content_hash_lib::get_mint_to_private_content_hash(amount)`, a git dep pinned to aztec-node `68274e7c` (`contracts/aztec/scripts/noir-deps.sh:19`, `token_bridge/Nargo.toml`) | **build new**: a bridge-local hash helper; the pinned upstream lib cannot take a depositor |
| C1 | Same, TS side | `packages/bridge-core/src/content-hash.ts` (`SELECTOR` map, `mintToPrivateContentHash`) | adapt |
| C2 | Cross-toolchain vectors | `contracts/aztec/keystone/src/main.nr`, `contracts/evm/test/ContentHash.t.sol`, `bridge-core/src/content-hash.ts` + tests; hand-built hashes in `PortalRoundtripFuzz.t.sol:56`, `RouterFixture.sol:59`, `TokenPortal.t.sol:70` | adapt (new vectors, six sites move together) |
| C3 | Claim secret bound to the L2 recipient | `contracts/aztec/claim_secret/src/lib.nr` (`derive_claim_secret(salt, recipient)`), `bridge-core/src/claim-secret.ts` | reuse-as-is |
| C4 | Token that enforces merchant rules | aztec-standards `Token` v6.0.0-rc.1, consumed two ways: Noir git dep (`token_bridge/Nargo.toml`, pinned `cdfba943`, `noir-deps.sh:21`) and npm artifact (`bridge-core/src/artifacts.ts:1`, TXE `run-txe-tests.sh:48`). No token source in the repo | **build new**: forked crate `contracts/aztec/token/`, since the rules must live in the token's own transfer paths. Base source: `~/nargo/github.com/AztecProtocol/aztec-standards/v6.0.0-rc.1/src/token_contract/src/main.nr` (717 lines) |
| C5 | Merchant register, per-merchant off switch, funding-address binding | Our crates use only `PublicMutable` / `PublicImmutable` | **build new** on aztec-nr's `DelayedPublicMutable`, `Map`, `Owned`; nothing to adapt locally |
| C6 | Admin and pause | `token_bridge`: two-step ownership, `set_paused` (`main.nr:67`), `_assert_not_paused` `#[only_self]` enqueued from private (`:86`) | reuse-as-is (copy the shape for merchant admin) |
| C7 | Noir test shape | `token_bridge/src/test/{utils,claims,claims_private,exits,guards,ownership,pause,proxy_guards}.nr`, `txe-manifest.txt` + floors (bridge 48, keystone 8) | reuse; `utils::setup` gains merchant setup; tests pinning today's open paths are **rewritten** (see risks) |
| C8 | EVM test shape | unit, fuzz, invariant, fork (`SepoliaFork`), halmos (8 proofs pinned in `scripts/halmos-gate.sh`), `Mutants.sol` + `ProofCanary`, `.gas-snapshot` (2 %) | reuse-as-is; each new proof needs its mutant, canary and gate entry |
| C9 | Protocol flows (TS) | `bridge-core/src/{deposit,claim,exit,withdraw}.ts` incl. reconciliation, sponsored fees, stale-proof rebuilds; drafts already carry the depositor (`deposit.ts:148`) | adapt (depositor into the portal call; exits branch on merchant vs bound address) |
| C10 | Deployer + operator CLI | `packages/deployer`: verb-object `COMMANDS` (`cli.ts:41`) under `runRedacted`; `verify.ts` read-back `Check[]`; `smoke.ts`, `budget.ts`; `withOwnedTmpDir` | adapt: add merchant and demo verbs, merchant read-backs, smoke legs, budget lines |
| C11 | Testnet secrets | `secrets.ts:93` `loadTestnetSecrets` reads `.env.testnet` (vars `TESTNET_L1_PRIVATE_KEY`, `TESTNET_AZTEC_SECRET_KEY`); redaction/needles (`secrets.ts:81`, `redact.ts`) | adapt: the source becomes the keyed-run environment; redaction stays as defence in depth |
| C12 | Keyed runs | Nothing in the repo. `env-exec` / `op-remote` are machine tools (my-stack "Keyed runs") | **build new**: a committed `*.env.example` template with `op://Keyed-Runs/...` refs and `# op:` directives |
| C13 | Local network + integration | `packages/local-network` (registry ports, owned groups), `packages/integration/test/harness.ts` (`openHarness`/`closeHarness`, `describe.skipIf(!INTEGRATION)`) | reuse-as-is; new specs beside `deposits.test.ts` / `exits.test.ts` / `guards.test.ts` |
| C14 | In-browser embedded wallets | `apps/web/e2e/test-wallet/wallet.ts:23` `TestWallet extends EmbeddedWallet`, `importSeed` (`:41`) builds a Schnorr account from a seed; OPFS sqlite wasm handling in `vite.config.ts`; COOP/COEP | adapt: promote from test harness to the showcase's per-actor wallet |
| C15 | Deterministic demo keys | None. Closest: `signingKeyFor(secret)` (`deployer/src/deploy-l2.ts:26`, sha256-derived Fq) and the literal `LOCAL_DEPLOYER_SECRET` (`local.ts:25`); e2e actors use `Fr.random()` | **build new**: label → secret derivation, composing `signingKeyFor` |
| C16 | Web build and hosting | `apps/web/build/target.ts` (`resolveTarget`, `cspFor`, `ISOLATION_HEADERS`; `frame-src` refused off-local), `vite.config.ts` `outputsPlugin` (`_headers`, embedded manifest), `wrangler.jsonc` (Worker `inference-money`, assets `./dist`) | reuse-as-is (moves with the rename) |
| C17 | App UI | Flow engines `src/bridge/*` (deposit/withdraw flows, env, amount, balances, pending, gate, explain) vs connect UI (`components/L1Connect.tsx`, `components/aztec/*`, `wallet/{aztec-session,session,l1,useAztecSession,prompt-queue,capabilities}.ts`) | adapt engines; **delete** the wagmi / wallet-sdk connect surface (demo only) |
| C18 | Browser e2e harness | `apps/web/e2e/{agent.sh,run/,playwright.config.ts,fixtures/}` (per-run network, sidecar, sharded single worker) | reuse; fixtures move from "connect a wallet" to "act as a demo actor" |
| C19 | CI | per-package `<pkg>.yml` + `_<pkg>.yml`, `changes` job via `dorny/paths-filter` | reuse; `web.yml` + `_e2e.yml` hardcode `apps/web` |
| C20 | Docs | `AGENTS.md`, `docs/{architecture,assurance-map,ci-pipeline,roadmap}.md`; assurance map = cells A1–A19 cited by test titles | adapt: A1/A4 rewritten, new cells from A20 |
| C21 | Sole-consumer guard | `contracts/aztec/scripts/check-sole-consumer.sh`: exactly 2 `consume_l1_to_l2_message` sites (`token_bridge/src/main.nr:96,116`), fixed shapes, no raw secret on the private path; 15 self-test mutants, CI runs `--self-test` | adapt: a refund path adds a consumer; keep the no-bearer-path invariant and extend the mutants |
| C22 | x402 compatibility | `@galactica-net/x402-mechanism` 1.1.2 calls only `initialize_transfer_commitment` and `transfer_private_to_commitment`; its facilitator opens commitments to itself | constraint: keep both signatures |

## Upstream facts the design rests on (Aztec v6.0.0-rc.1)

- **DelayedPublicMutable** (`aztec-nr/aztec/src/state_vars/delayed_public_mutable.nr`): minimum delay 1 hour (`:16`), enforced at init (`:140`) and on change (`:273`). The delay itself is changeable, and a delay change is itself scheduled. A private read sets the tx's public `expiration_timestamp` to anchor + delay, or to a pending change's time if sooner (`:420-459`). That is the documented leak; upstream recommends `MAX_TX_LIFETIME` (86400 s) so users share the privacy set of contracts that use no DPM (`:86`).
- **Token supply is public**: `_mint_to_private` / `_burn_private` (`token_contract/src/main.nr:692,712`) enqueue public total-supply updates. Private claim and withdrawal amounts are therefore readable; the accounts are not.
- **Payment requests are partial notes**: `initialize_transfer_commitment(to, completer)` (`:244`) pushes a validity commitment `hash(partial, completer)` (`uint-note/src/uint_note.nr:136`); `complete` (public, `:189`) checks it exists. Completion does not consume it, and the completion log carries the amount.
- Commitment entrypoints to gate: `transfer_private_to_commitment` (`:198`), `transfer_public_to_commitment` (`:296`), `transfer_private_to_public_with_commitment` (`:150`, opens a commitment for `to` with the sender as completer).

## Off-chain notes

- **bridge-core** is per-actor already (no singletons); its API survives. `artifacts.ts` imports Token from npm today and bridge/proxy from committed `target/*.json`; the fork joins the latter. Class ids pinned in `artifacts.test.ts:9-11`.
- **deployer**: `cli.ts:47` prints a reminder naming `.env.testnet`. `scrubbedEnv` (`secrets.ts:57`) strips secrets from child environments; keep it. `.env.testnet` does **not** exist on this host (checked 2026-09-30 in the canonical clone and the worktree), so the previous deployment's owner key lives elsewhere, if anywhere.
- **Keyed-run constraints** (my-stack): the approved run pins a pushed commit; `env-exec request` refuses a dirty tree, untracked files, an unpushed HEAD, and uncommitted `.env*` / `bunfig.toml`. Values are single-line, 8–4096 bytes, `op://Keyed-Runs/<Project>-<Env>/<FIELD>` only; `# op: generate eth-key | fr | hex32 | import`. The command runs with stdin `/dev/null`, secrets arrive only in its environment, output is masked (literal and hex).
- **apps/web**: `aztecSession` (`src/wallet/session.ts:8`) and `wagmiConfig` (`src/wallet/l1.ts:11`) are module singletons; the demo needs one wallet per actor. Root `test:e2e` is `bun run --cwd apps/web test:e2e` (`package.json:28`).
- **Workers Builds** reads its root directory from the Cloudflare dashboard; renaming `apps/web` breaks deploys until the owner changes it.

## Collision and dedup risks

1. **Depositor-bound hash**: the riskiest wiring change. The L1 content, the Noir helper (new, local), the TS mirror, the keystone vectors, `ContentHash.t.sol`, and three EVM test reconstructions must move in one step, or the keystone fails.
2. **Tests that pin today's open behaviour** must be rewritten, not extended: `token_bridge/src/test/claims.nr` (`claim_public_by_relayer_credits_the_recipient`), `exits.nr` (public exits with no merchant check), and assurance cells A1/A4 ("whoever submits").
3. **Token fork coupling**: new crate, `compile.sh` crate list (`:28`), `noir-deps.sh` rows for any new git dep (CI `--exact`), committed artifacts + `--check`, the TXE artifact path (`run-txe-tests.sh:48`), the class-id literal, and the `artifacts.ts` import all change together; `@aztec-foundation/aztec-standards` then has no consumer left.
4. **Sole-consumer guard** hardcodes two consumers; a refund path is a third, and its self-test mutants must cover it.
5. **`apps/web` references** outside the app: `.github/workflows/{web,_e2e}.yml`, `AGENTS.md`, `biome.json`, `bun.lock`, `docs/{assurance-map,ci-pipeline}.md`, `package.json` (plus the old plan's own files).
6. **`@aztec-labs/ethereum` ban** (biome `noRestrictedImports`) still applies to anything moving into the showcase.

## Absence search trails

- Noir state vars beyond Public*: `grep -rn "PublicImmutable\|PrivateImmutable\|DelayedPublicMutable\|state_vars::Map\|Owned\b" contracts/aztec --include=*.nr` (non-test): only `PublicImmutable` / `PublicMutable`.
- Label-derived keys: `grep -rn "deterministic\|fromLabel\|labelToSeed" apps/web packages`: none.
- Merchant / commitment primitives: `grep -rln "x402\|commitment\|PartialUintNote\|merchant"` over `*.ts,*.nr,*.md`: only the AGENTS.md motivation line and plan docs.
- Token source: `grep -rn aztec-standards`: dependency declarations and the npm artifact import only.
- Wrangler configs: `find . -iname "wrangler*" -not -path "*/node_modules/*"`: only `apps/web/wrangler.jsonc`.
- Keyed-run templates: `find . -name "*.env.example" -not -path "*/node_modules/*"`: none.
