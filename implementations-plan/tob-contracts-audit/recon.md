# Recon: fixing the Trail of Bits contracts audit findings

Base: `be70fec` (main after the harden-security arc). Two read-only explorers: a reuse sweep over the six capabilities the fixes need, and a ripple map of what moves when deployed contract code changes. Nothing was run; gas and size figures are estimates.

## Reuse map

| Capability | Existing code | Verdict |
|---|---|---|
| Static payout rule for the bridge | `contracts/aztec/scripts/check-sole-consumer.sh`: `pays_depositor` (L116-125) already pins both returns to exactly one `message_portal(config.portal, withdraw_content_hash(depositor, amount, EthAddress::zero()))` and bans mints; `bound_to` + `need` (L51-69) pin a `let`-bound hash; `mutant` (L219) drives `--self-test`. The exits (L172 `check_exits`) have no portal rule. CI runs it (`_contracts.yml` L52-55). | adapt: add an exit rule in the same shape (`bound_to` the `let content = withdraw_content_hash(recipient, amount, caller_on_l1)`, then `need` one `message_portal(config.portal, content)`), plus single-rule mutants; update the header comment |
| Stranger refusal tests (bridge) | `token_bridge/src/test/pause.nr` `non_owner_cannot_pause`; `utils::setup()`; `env.create_light_account()` | reuse the shape; four new tests in `ownership.nr` |
| Stranger refusal tests (token) | `token/src/test/merchants.nr` `add_merchant_is_admin_only` etc.; `utils::setup_merchant_world(false)` | reuse the shape; two new tests |
| TXE manifests and floors | `*/txe-manifest.txt` (bridge 74 sorted; token 162 in two sorted blocks, merchant names in the second); floors in `run-txe-tests.sh` L22-30 equal the counts | adapt: add names in sorted position, raise floors by the same count |
| Hash-locked Python tool in CI | `.github/actions/setup-toolchains/action.yml` halmos step (venv, `pip install --require-hashes --no-deps --only-binary :all:`, symlink into `$RUNNER_TEMP/bin`); `halmos-0.3.3.requirements.txt` header holds the `uv pip compile --universal --generate-hashes --no-header --exclude-newer <a week ago>` recipe; `toolchain.json` is the version source | adapt: `slither-<ver>.requirements.txt`, a `slither` input, its own venv; foundry must install when slither is requested |
| Slither config | none (no config, no `slither-disable` comments, no CI mention) | build new: a `test:evm:slither` script scoped to `src/` |
| Event emission (L2) | token `#[event]` structs + `self.emit(...)` (`token/src/main.nr` L63-88); bridge has no events | reuse the token's pattern in the bridge |
| Event assertions (L2) | none: TXE's `TxEffects` exposes note hashes, nullifiers and private logs only; no TXE test asserts a log | build new: assert via `getPublicEvents` in an integration spec (precedent: `bridge-core/src/merchants.ts` reads `MerchantAdded` that way) |
| Event assertions (L1) | `vm.expectEmit(address(portal))` on deposits (`TokenPortal.t.sol` L64-108) | reuse for `withdraw` and `initialize` |
| Fake Inbox index | `CapturingInbox` in `test/mocks/AztecFakes.sol`: `index = sent++`, starts at 0, no setter | adapt: deposit twice in the test (precedent `test_depositFor_namesTheRoutersDepositor`) rather than changing a shared mock |
| Over-delivering token | none in `test/mocks/TestTokens.sol` (fee-on-transfer, surcharge, hook, blacklistable exist) | build new: `OverDeliveringERC20`, mirroring `FeeOnTransferERC20`'s `_update` override |
| Router mismatch fuzz | `StubRouter` (`test/mocks/MockPortal.sol` L68-77); fuzz tests live in `PortalRoundtripFuzz.t.sol` / `Permit2DepositRouterFuzz.t.sol` as `testFuzz_*` | reuse `StubRouter`; new `testFuzz_` in the portal fuzz file |
| Transient guard | `TokenPortal` already inherits `ReentrancyGuardTransient` (OZ 5.6.1); same `ReentrancyGuardReentrantCall` selector | adapt: router import + base; `Permit2DepositRouter.t.sol` L5, L146 import |
| USDC behaviour docs | nothing documents blocklist / USDC pause / upgrade; `test_blacklistedRecipient_revertsAtomicallyAndStaysRetriable` pins the behaviour | build new: a bold-lead paragraph after **Withdraw (L2 → L1).** in `docs/architecture.md`, and a line under "Messages between the chains" in `docs/integration.md` |

## Ripple of a deployed-code change

- **No `PROTOCOL_VERSION` bump.** Events change no message content hash, storage layout or ticket format; precedent: 56c8665 and 8a6a523 changed contracts without one.
- **Token events:** append each new `"Token::<Name>"` to `ADDED_EVENTS` (`contracts/aztec/scripts/abi-superset.test.ts:27`). Public bytecode stays far under the 2,700-field ceiling (1,219 now).
- **Artifacts:** rebuild token and bridge through `compile.sh` (token first); `compile.sh --check` before commit; the proxy probably does not move.
- **Class-id pins:** `packages/bridge-core/src/artifacts.test.ts:9-11` (token and bridge).
- **L1 ABI:** `abi.test.ts` pins one way, so new forge events do not fail it; adding `Withdraw` to `TOKEN_PORTAL_ABI` (`bridge-core/src/abi.ts`) exports it to integrators.
- **Event readers:** `getPublicEvents` filters by event tag, so new L2 event types are invisible to `merchants.ts`; L1 readers filter by address and event name (`deposit.ts`, `withdraw.ts`), so a portal `Withdraw` breaks nothing. The comment at `token/src/main.nr:72` ("a complete feed of the list") stays true but should say "entry".
- **`set_merchant_delay`** changes the global setting, not an entry: give it its own event, never `MerchantDelayScheduled`.
- **Testnet:** already stranded since 56c8665 (stale token class id; follow-up line 7). Every contract here folds into that one redeploy; `TokenPortal.initialize` is init-once, so it is a full redeploy.
- **Gas snapshot:** the router's guard moves from storage to transient. Estimated saving is about 2-5k on about 595k, inside the 2% tolerance. Regenerate it from inside `contracts/evm` anyway.
- **halmos:** no proof, mutant or canary covers events or the guard type. The router proofs will now execute TSTORE; FormalPortal already does, so run `test:evm:formal` after the switch.
- **Text-pinned bridge source:** `check-sole-consumer.sh` takes a function body as everything up to the next ` fn `.
  - So event structs placed between checked functions become part of their bodies. Put them before the first `fn`.
  - Do not reformat `main.nr`: the `--self-test` mutants match multi-line literals.

## Collision and dedup risks

- Do not add a second return rule: `pays_depositor` already covers them; extend, and keep reason strings unique for the self-test.
- Floors are minimums: forgetting to raise them fails nothing, so raise them with the manifests.
- The `$RUNNER_TEMP/bin` dir is shared by the halmos and slither steps; separate venvs.
- `Initialized` collides by name (not selector) with OZ's `Initialized(uint64)`; prefer a distinct name.

## Corrections to the audit

The audit's F-1 counted both returns and both exits. The two returns are already pinned by `check-sole-consumer.sh` in CI; the mutation run executed only the TXE tests. F-1 is the two exits only (report corrected 2026-10-03).
