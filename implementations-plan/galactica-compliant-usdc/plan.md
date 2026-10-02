---
plan: galactica-compliant-usdc
tier: deep
driver: claude-code
eli5_mode: artifact
code_review: off
claude_model: opus
harden: "/harden security medium on contracts/ (EVM + Noir) once testnet is live (user decision at Phase 0); accepted findings are fixed in arc 6, with a keyed-run redeploy if contract bytes change"
budget: "recon 3 agents (done); /code-review off; codex high on gpt-6-astra, at most 3 rounds per arc plus one fresh cross-arc pass; Claude leg Opus 5.5. Testnet per deploy + acceptance run: at most 0.1 Sepolia ETH, 100 test USDC, 80 FJ of sponsor top-ups. Demo float: at most 0.02 ETH + 50 USDC on L1, 50 USDC on L2. CI e2e at most 90 min."
status: "approved 2026-09-30 (all asks answered; P9 disposable fallback added at the gate); in progress: P1 ✓ P2 ✓ P3 ✓ P4 ✓ P5 ✓ P6 ✓ P7 ✓"
---

# galactica-compliant-usdc

Rebuild this repo as Galactica's compliant USDC:
- **Token and bridge.** A fork of the aztec-standards token lets users pay only merchants, or into payment requests a merchant opened while it was listed. Deposits record the Ethereum address they came from, and a user's withdrawals can only go back to it. An operator CLI deploys and runs all of it.
- **Showcase.** A demo-only page runs the flows with embedded wallets. Everything goes live on Sepolia + Aztec testnet, then the contracts get a `/harden security` pass.

The design was agreed with the user and is recorded in the explainer (https://claude.ai/artifact/XCL4MmbRY9RBRcvMpqb1dn). This plan is how to build it. `recon.md` is the map of what exists. Three independent drafts fed this plan: main, codex and fable (Opus 5.5). The decision ledger at the end says which choice came from where.

Roles, used throughout:
- **Merchant:** an account on Galactica's list (its own accounts, its x402 facilitator's receiving account, its suppliers).
- **User:** everyone else, including a merchant that has been switched off.
- **Sender:** always the owner of the funds (the token's `from`), never whoever submits the tx.

## Outcome & Quality Bar

**Galactica's engineers**, integrating the token into their wallet and x402 facilitator:
- The token is a strict ABI superset of aztec-standards `Token` v6.0.0-rc.1.
  - Every upstream function keeps its name, parameters, return type, attributes and selector.
  - Upstream storage slots don't move.
  - The additions are exactly the list in this plan.
  - `contracts/aztec/scripts/abi-superset.test.ts` pins all three. Galactica's two x402 calls (`initialize_transfer_commitment`, `transfer_private_to_commitment`) keep working unchanged.
- Every rule has an allowed-path test and a refused-path test in TXE, where the app enforces it, and in kernel-validated integration. The testnet acceptance run covers the full flow and its two refusals.
- Each refusal carries one exact rule string, exported from `bridge-core/src/rules.ts` and matched against the Noir sources by a test.
- `bun run bridge export <manifest> --out <dir>` writes what a wallet or facilitator registers: address, class id, instance and the artifact with its sha256. A test registers the export in a fresh wallet and reads a balance through it.
- `docs/integration.md` covers the rules, every refusal string, the L1↔L2 message formats and what each action makes public. It fits in a few pages.

**Galactica's operator**, deploying and running the bridge:
- Every operation is one `bun run bridge …` command. Secrets come only from the process environment. `verify` and `export` need no keys.
- `verify` passes against a build of the manifest's `sourceCommit`, and fails on each drift P8 injects locally: wrong admin, pending handover, foreign minter, unsynced delay, a guardian slot below the setting, reserve below supply.
- After the handover no deploy key holds a role, and `verify` enforces it.
- `docs/operations.md` gives the exact commands and timings for:
  - adding merchants;
  - switching one off or back on;
  - changing the delay, including the 1 h option and what it costs;
  - the emergency path;
  - the handover;
  - demo refill.

**A showcase visitor**, usually someone Galactica sends to understand the product in two minutes:
- The guided tour replays the recorded testnet acceptance run instantly, with real tx links and the "What the world sees" feed.
- In "Try it yourself", every refused attempt fails at simulation within seconds, shows the contract's rule text and sends nothing. The e2e proves this by capturing network traffic.
- Happy-path steps run live on testnet while the float allows. They are proven in the browser when P10's measured thresholds pass; otherwise they are simulated live with the recorded proof shown. Every step is labelled live or recorded, and recorded execution is never passed off as live. The local e2e proves every step; on the hosted preview, P13 proves the live Ethereum lane and one live L2 action.
- The feed is labelled as what the public chains show for equivalent production accounts. The demo accounts' keys ship in the page, so the demo accounts themselves keep nothing private.
- The page stays usable when the demo float is empty or another visitor races it (retry, reset, replay).

**A future maintainer**:
- Every rule has an assurance-map cell (A20–A29) that names its tests.
- Every cross-toolchain literal is pinned in each toolchain that uses it: three content hashes (Noir, Solidity, TypeScript), two stamp separators and the side-hint capsule slot (Noir, TypeScript).
- The fork's delta from upstream is reviewable. P1 lands a verbatim copy, so a diff against that commit is the delta, and the provenance header names the upstream commit and summarizes the delta in a few lines.

**Good enough stops at:**
- no x402 end-to-end test;
- a desktop-first showcase;
- shared demo accounts that can race (retry and replay are the answer);
- browser proving measured and gated, not tuned;
- no multisig tooling (documented as a follow-up);
- no mainnet fee path or rollup-upgrade handling.

## Architecture & Implementation

### Proposed architecture

```
Ethereum (Sepolia)                                              Aztec 6.0.0-rc.1
Permit2DepositRouter ─depositToAztec{Private,Public}For(signer,…)─┐
direct caller ───────depositToAztec{Private,Public}(…)────────────┤
                                                   TokenPortal ───┴─ L1→L2 message (content hashes the depositor) ─▶ TokenBridge
TokenPortal.withdraw ◀─ L2→L1 withdraw(recipient, amount, caller) ─────────────────────────── claims / returns / exits
                                                                        TokenBridge ─▶ TokenMinterProxy (bridge only) ─▶ Token (merchant fork)
                                                                        TokenBridge ─▶ Token.is_merchant (public) / try_prove_merchant (private view)
Noir libs: portal_messages (content hashes) · merchant_stamp (stamp, pad) · claim_secret (unchanged) · keystone (vectors)
TS: bridge-core (flows, rules, preflights) · demo (cast, tour, world view) · deployer (`bun run bridge`) · integration · apps/showcase
```

- **The merchant list lives in the token.** A `DelayedPublicMutable` can only be read privately by the contract that owns it (`aztec-nr/aztec/src/state_vars/delayed_public_mutable.nr:548-559` reads at `this_address`). So a separate registry would cost one extra private call on every restricted transfer. The bridge asks the token only on merchant branches.
- **The funding-address binding lives in the bridge**, as a private note the account owns.
- **Deposit content hashes** move to a local Noir lib (`contracts/aztec/portal_messages`), because the upstream `token_portal_content_hash_lib` is pinned and can't take a depositor. Withdraw keeps its format.
- **Trust model:**
  - The admin (a multisig in production) curates the list, pauses the bridge, and owns both two-step handovers.
  - The optional guardian can only cancel pending merchant changes. The admin replaces it on the same delayed schedule. It is unset on testnet.
  - The proxy lets only the bridge mint and burn.
  - The portal lets only its bound router name a depositor.
  - Nothing trusts the demo keys.

### Key interfaces, storage, message formats

#### Token (`contracts/aztec/token`, package `merchant_token`, contract `Token`)

Storage. The upstream fields (`token_contract/src/main.nr:53-63`) come first, unchanged, so their slots don't move. Appended:

```rust
merchant_admin: PublicMutable<AztecAddress, Context>,
pending_merchant_admin: PublicMutable<AztecAddress, Context>,
merchant_guardian: DelayedPublicMutable<AztecAddress, 3600, Context>,     // replaced on the delay; constructors raise it to the setting
merchant_delay: PublicMutable<u64, Context>,                               // the setting, in [3600, 86400]
merchants: Map<AztecAddress, PublicImmutable<bool, Context>, Context>,    // append-only register; adds are instant
merchant_off: Map<AztecAddress, DelayedPublicMutable<bool, 3600, Context>, Context>, // default false = on
```

**Constructors.** Both upstream initializers keep their signatures. Each also sets `merchant_admin = msg_sender` and `merchant_delay = 86400`, and calls `merchant_guardian.schedule_delay_change(86400)`. A DPM schedules with its current delay (`delayed_public_mutable.nr:203-208`), so without that call a fresh deployment's guardian could be replaced after 3600 s; the increase applies at once. The deployment uses `constructor_with_minter` with the proxy as minter and `auth_contract = 0`; the ARC-403 hook stays verbatim and dormant.

**Additions.** This exact list is pinned by the ABI test.
- Admin-only, public:
  - `add_merchant(account)`:
    - rejects zero and already-registered accounts;
    - runs `merchants.at(a).initialize(true)`, then `merchant_off.at(a).schedule_delay_change(merchant_delay)`;
    - emits `MerchantAdded { account }` and `MerchantDelayScheduled { account, delay, effective_at }`.
  - `schedule_merchant_off(account, off: bool)`:
    - the account must be registered;
    - a no-op if the latest scheduled value already equals `off`, so repeat calls never restart the clock;
    - scheduling the current value is how a pending change is cancelled;
    - emits `MerchantOffScheduled { account, off, effective_at }`.
  - `set_merchant_delay(delay)`: enforces 3600 ≤ delay ≤ 86400, and also schedules the guardian slot's delay.
  - `sync_merchant_delay(account)`: a no-op when the entry's scheduled delay already equals the setting; otherwise it emits `MerchantDelayScheduled`.
  - `propose_merchant_admin(new)`, where zero cancels.
  - `schedule_merchant_guardian(guardian)`: takes effect after the delay; zero removes the guardian.
- `accept_merchant_admin()`: public, pending admin only.
- `cancel_merchant_change(account)`: public, admin or guardian.
  - Requires a pending change: a scheduled value that differs from the current one, or a pending delay decrease. Re-scheduling an unchanged value would only restart the mark, so a guardian could otherwise keep an entry marked forever.
  - Re-schedules the current value, and the current delay if a decrease is pending, emitting the matching events. So every change to an entry has an event, and the events form a complete feed of the list.
  - The guardian can do nothing else.
- Public views:
  - `is_merchant(account) -> bool`, which is `merchants.at(a).is_initialized() & !merchant_off.at(a).get_current_value()`;
  - `get_merchant_status(account)`: registered, off, scheduled off and when, delay, scheduled delay and when;
  - `get_merchant_roles()`: admin, pending admin, guardian, scheduled guardian and when, delay.
- Private view `try_prove_merchant(account) -> bool`.
  - `true` is proven at the anchor block.
  - `false` is only the prover's claim, and callers may use it only to refuse. The doc comment says so.

**Rule proof shapes.** Every check runs first in the function body, before `_call_auth_private` and any note read, so a refusal needs no note sync. The authwit check that `#[authorize_once]` prepends still runs earlier (`macros/internals_functions_generation/external/private.nr:173-181`): a delegated call without a valid authwit fails authorization first, and the rule text is guaranteed only for otherwise-authorized calls.

| Entry point | Hint picks | Constrained proof | Extra side effect |
|---|---|---|---|
| `transfer_private_to_private`, `transfer_private_to_public`, `transfer_public_to_private` | `from` or `to` | `_assert_merchant(side)` | none |
| `transfer_private_to_public_with_commitment` | `to` (stamp), else `from` (pad) | `_assert_merchant(side)` | 1 nullifier: `stamp(c)` or `pad(c)` |
| `initialize_transfer_commitment` | `to` (stamp), else the creator `msg_sender` (pad) | `_assert_merchant(side)` | 1 nullifier: `stamp(c)` or `pad(c)` |
| `transfer_private_to_commitment` | `from` is a merchant, else stamped | `_assert_merchant(from)` or `assert_nullifier_exists(for_settled(silo(stamp(c))))` | none |
| `transfer_public_to_commitment` (public) | – | `is_merchant(from) \| nullifier_exists_unsafe(stamp(c), this)` | none |
| `transfer_public_to_public`, `mint_*`, `burn_*` | – | upstream, unchanged | none |

```rust
fn _assert_either_merchant(a, b, refusal) {
    // Safety: the hint only chooses which side is proven; a wrong hint yields an unprovable tx, never a false pass.
    let side = unsafe { merchant_side_hint(a, b) };           // 0 = a, 1 = b, 2 = neither
    assert(side != 2, refusal);
    _assert_merchant(if side == 0 { a } else { b });
}
fn _assert_merchant(x) {
    assert(self.storage.merchants.at(x).read(), "Not a registered merchant"); // oracle pre-check + existence request + historical read
    assert(!self.storage.merchant_off.at(x).get_current_value(), "Merchant is switched off"); // caps expiry
}
```

**The side hint.** `merchant_side_hint` first loads a transient capsule: `capsules::load(this, MERCHANT_SIDE_SLOT, AztecAddress::zero())`, one field holding 0, 1 or 2. The zero address is the global capsule scope, always allowed (`pxe/storage/capsule_store/capsule_service.js:11-15`), and the class registry passes its bytecode the same way (`contract_class_registry_contract/src/main.nr:77-81`).
- The choice follows three rules, the same in the SDK and in the fallback probe:
  1. Any eligible merchant side is kept; the answer is "neither" only when no side is a merchant.
  2. When opening a request (`initialize_transfer_commitment`, `transfer_private_to_public_with_commitment`), the recipient is proven whenever it is a merchant, so a merchant's request is stamped, never padded.
  3. Otherwise, between two merchants, prove the one whose entry has no change scheduled ahead, which keeps the tx's expiry longest. A cancel or switch-on schedules one too (mechanics 3).
- bridge-core and the showcase always attach it. They compute the side from the token's entry events, which they sync in bulk for the whole list. One capsule serves every restricted call in its tx, so the SDK never batches calls whose sides differ.
- Without a capsule (a generic wallet), the hint probes the anchor block through oracles. It checks the register nullifier with `check_nullifier_exists` and evaluates the DPM slots with `ScheduledValueChange::get_current_at(anchor_ts)`. It probes the counterparty before the sender, and the stamp before `from` when paying a request.
- A capsule or probe that picks the wrong side fails simulation. The SDK re-syncs the list and retries once.

A merchant check costs two historical reads, about 8k gates (inference: small next to the kernels; see Assumptions). What the queries reveal to the wallet's node is in the privacy ledger.

**Stamp** (`contracts/aztec/merchant_stamp`, a library shaped like `claim_secret`):
- `stamp(c) = poseidon2_hash_with_separator([c], DOM_SEP__MERCHANT_STAMP)` and `pad(c) = poseidon2_hash_with_separator([c], DOM_SEP__MERCHANT_STAMP_PAD)`.
- Both are pushed as token-siloed nullifiers, so only the token can create them.
- The separators are `poseidon2_hash_bytes("dom_sep__merchant_token_stamp[_pad]") as u32`, pinned as literals. The keystone re-derives both and asserts they differ from each other, from the protocol separators and from the claim-secret separator.
- The pad makes a request opened for a user (only a merchant can do that) publish the same number of nullifiers as one opened for a merchant.

**Refusal strings.** Exported by `bridge-core/src/rules.ts`; a test greps the Noir sources for each.
- Token rules:
  - `Transfer refused: neither sender nor recipient is a merchant`
  - `Request refused: neither creator nor recipient is a merchant`
  - `Payment refused: users may only pay into requests opened for a merchant`
- Token admin and state:
  - `Only the merchant admin`
  - `Only the merchant admin or guardian`
  - `Only the pending merchant admin`
  - `No pending change`
  - `Merchant already added`
  - `Not a registered merchant`
  - `Delay out of range`
  - `Merchant is switched off`
- Bridge:
  - `Only the recipient can claim privately`
  - `Deposit is not from this account's funding address`
  - `Public claims are for merchants only`
  - `A merchant's public deposit is claimed, not returned`
  - `Withdrawals from a user account go only to its funding address`
  - `Public exits are for merchants only`

#### Bridge (`contracts/aztec/token_bridge`)

- `Config { token_minter_proxy, token, portal }` is still one `PublicImmutable`; `constructor(token_minter_proxy, token, portal)`.
- Storage appends `funding_address: Owned<PrivateImmutable<FundingAddressNote, Context>, Context>`, where `#[note] FundingAddressNote { address: EthAddress }`.
- The one-per-account marker is `PrivateImmutable`'s initialization nullifier `poseidon2([slot, owner, nhk_app(owner)])` (`private_immutable.nr:66-72`). Only the owner's keys can compute it, and a second `initialize` collides at the sequencer.

| Function | Rule and proof shape |
|---|---|
| `claim_private(recipient, amount, claim_salt, message_leaf_index, depositor, bind: bool)` (private) | • Enqueue the pause check; `amount > 0`; `recipient != 0`.<br>• `msg_sender == recipient`.<br>• Consume `mint_to_private(amount, depositor)` with `derive_claim_secret(claim_salt, recipient)`.<br>• `bind` → `initialize(FundingAddressNote { depositor })`, delivered `onchain_unconstrained()` so a restored wallet rediscovers it; `!bind` → `get_note().address == depositor`.<br>• Mint through the proxy.<br>• A wrong `bind` only fails: `true` on a bound account is a duplicate nullifier, `false` on an unbound one has no note to read. |
| `claim_public(to, amount, secret, message_leaf_index, depositor)` (public) | • Pause check; `amount > 0`.<br>• `Token.is_merchant(to)`.<br>• Consume `mint_to_public(to, amount, depositor)`; mint.<br>• Stays relayable (the mint goes to the committed merchant). |
| `return_deposit_private(recipient, amount, claim_salt, message_leaf_index, depositor)` (private) | • Enqueue the pause check.<br>• Consume with the derived secret.<br>• `message_portal(portal, withdraw(depositor, amount, 0))`.<br>• Mints nothing; whoever holds the claim data may call it. |
| `return_deposit_public(to, amount, secret, message_leaf_index, depositor)` (public) | • Pause check.<br>• `!Token.is_merchant(to)`. Otherwise anyone could copy a merchant's claim secret from the mempool and bounce its deposit.<br>• Consume, then message the portal the same way. |
| `exit_to_l1_private(recipient, amount, caller_on_l1, authwit_nonce, as_merchant: bool)` (private) | • `!as_merchant` → an unconstrained "has a note" pre-check fails with the rule text before `get_note()` can fail generically; then read the sender's note and require `address == recipient`.<br>• `as_merchant` → `Token.try_prove_merchant(sender)` must be `true`.<br>• Both branches fail with `Withdrawals from a user account go only to its funding address`.<br>• Then message the portal and burn, as today. |
| `exit_to_l1_public` (signature unchanged) | `Token.is_merchant(sender)`. |
| `get_funding_address(owner) -> EthAddress` (utility) | Zero when unbound. |

**Merchants bind too.** A merchant's first private claim binds its account like anyone's. Its exits stay unrestricted, and a merchant funding from several treasuries uses public deposits (`claim_public`), which never bind.

#### L1

**`TokenPortal`**
- Adds `address public router`.
- `initialize(registry, underlying, l2Bridge, router)` stays initializer-only and init-once. It reverts with `RouterMismatch` unless `router.PORTAL() == this` and `router.TOKEN() == underlying`.
- Direct deposits keep their signatures and record `msg.sender` as the depositor.
- New router-only functions, `depositToAztecPrivateFor(address depositor, uint256 amount, bytes32 secretHash)` and `depositToAztecPublicFor(address depositor, bytes32 to, uint256 amount, bytes32 secretHash)`.
  - A virtual `_requireRouter()` reverts with `NotRouter` before any hashing or pull.
  - `_pullExact` still pulls from `msg.sender`, which is the router.
- Both deposit events gain `address indexed depositor`. `withdraw` is unchanged.
- The header comment (`TokenPortal.sol:3-5`) stops claiming canonical content hashes.

**`Permit2DepositRouter`**
- `constructor(permit2, portal, token)` checks code length only. `PortalNotInitialized` goes: the portal checks the binding at `initialize`.
- `deposit(...)`'s ABI and the Permit2 witness are unchanged. It calls the `…For` variants with a virtual `_depositor()`, which returns `msg.sender`, the Permit2 owner (`Permit2DepositRouter.sol:85`).

#### Message formats (L1 = `Hash.sha256ToField(abi.encodeWithSignature(...))`, mirrored in Noir and TS)

Secret hashes don't change. A private message's secret hash stays `compute_secret_hash(derive_claim_secret(salt, recipient))`; a public one's stays `compute_secret_hash(secret)`.

| Message | Signature (selector) | Vector for amount 1_000_000, to `0x1234`, depositor `0xD0D0`, recipient `0xBEEF`, caller 0 |
|---|---|---|
| Private deposit | `mint_to_private(uint256,address)` (`0x69248b42`) | `0x006bfc126e408142a4cc801b6780b5c8c7ad7bfc7cb23d1a2cbb731a958c2a07` |
| Public deposit | `mint_to_public(bytes32,uint256,address)` (`0x05829b7e`) | `0x00dbc90158731bb184636b606f4a34496eb320d1215f259c4c53afeea7629e23` |
| Withdraw / return | `withdraw(address,uint256,address)` (`0x69328dec`), unchanged | `0x00ac390e12f1097130e1a7c2e5eea30780cd11d12002b8de22d608cf10a60775` (today's pin) |

Two planners computed these independently with viem during planning, and the same method reproduces today's pinned `MINT_TO_PRIVATE` and `WITHDRAW` literals (`ContentHash.t.sol:18-19`). P4 and P5 still recompute them in each toolchain before pinning.

#### Off-chain surfaces

**bridge-core**
- `content-hash.ts`: new selectors, plus a depositor parameter.
- `claim.ts`:
  - private claims are sent from the recipient;
  - `bind` comes from `get_funding_address`;
  - the ticket gains `depositor`, read from the router's `Deposit` event or the portal's new event field.
- `return.ts`: builds an exit ticket for `withdraw(depositor, amount, 0)` and reuses the exit resume and finish machinery.
- `merchants.ts`: the list, synced in bulk from the token's events, and the side capsule for every restricted call.
- `payments.ts` (open, pay, `isStamped`) and `stamp.ts`. Upstream completion is not single-use, and the recipient discovers only the first completion, so a second payment into the same request is lost (`uint_note.nr:183-188`). So `pay` refuses a commitment it has already paid or is paying, with one record per commitment:
  - `reserved`, claimed under an exclusive lock before simulation; a failure before proving releases it;
  - `sent`, with the tx hash and expiry recorded after proving and before the send. It is reconciled by that hash, and released only once the expiry passes without inclusion, so an uncertain send never allows a second one;
  - `paid`, once the tx is finalized.

  The store is injected: `localStorage` under Web Locks in the showcase, and the smoke's locked state directory in the CLI. Tests cover a reload mid-payment and two tabs. Galactica's own x402 client doesn't go through `payments.ts` and needs the same guard, as `integration.md` says. Two devices paying the same request remain a residual.
- `rules.ts`: the refusal strings, plus a mapper from simulation errors to rule ids.
- Preflights, before any signing or proving:
  - a public deposit's recipient must be a merchant;
  - a private deposit into a bound account must come from its funding address;
  - a first claim warns "this binds the account to 0x… forever";
  - an exit's destination must be the funding address, unless the sender is a merchant.
- Message consumption is no longer proof of a claim. Reconciliation tracks intent, tx hash and effects, and reports `consumed-unknown` rather than a mint when only the nullifier is seen.
- `signing-key.ts`: `signingKeyFor` moves here from `deploy-l2.ts:26`, using viem `sha256` over the identical preimage. A pinned vector keeps the local deployer address unchanged.
- `artifacts.ts` imports the fork's committed JSON, and the npm token dependency goes.
- The manifest schema adds `protocolVersion: 2`, `sourceCommit`, `l1.deployer` and `l2.admin`; durable tickets carry the protocol version. When the current artifacts don't match a manifest (`instances.ts:27-38`), the error names that manifest's `sourceCommit`, whose CLI can still finish its tickets.

**`packages/demo`** (`@inference-money/demo`, browser-safe, shared by the deployer and the showcase)
- `cast.ts`: `alice` and `bob` are users; `galactica` and `supplier` are merchants. Every key is public, because the page ships it.
  - The merchants' Aztec secrets and all L1 keys derive from the deployment: `sha256("inference-money/demo/<bridge>/<actor>/aztec|ethereum")`, reduced into the field or [1, n). A_demo is alice's L1 key and B_demo is bob's.
  - The users' Aztec secrets also take a random tag: `sha256("inference-money/demo/<bridge>/<tag>/<actor>/aztec")`. `demo setup` draws the tag and binds alice to A_demo and bob to B_demo with their first claims. It waits until both claims are finalized (`waitClaimFinalized`), because a pruned binding could be re-bound by anyone once the tag is public, and only then writes the tag to `deployments/testnet-demo.json` (on local, the run's directory). Until then its state stays private and resumable. So nobody can bind a user account before the demo does, and a rotation (`demo setup --rotate`) draws a tag nobody can predict.
  - Signing keys: `signingKeyFor`.
- `tour.ts`: the zod schema for `deployments/testnet-tour.json`:

  ```
  { version, network: { l1ChainId, rollupVersion }, contracts: { portal, router, token, bridge },
    steps: [{ id, actor, action, to, amount, verdict: settled | refused, rule?, l1?: { txHash, block },
              l2?: { txHash, block, expiration }, world: [{ chain, label, value?, visibility: readable | hidden }] }] }
  ```
- `world-view.ts`: decodes a TxEffect plus the expiry captured at send, and L1 receipts, into readable and hidden items. It keeps actual public fields apart from the actor labels the demo supplies.

**Operator CLI** (`bun run bridge <command>`; `<manifest>` is a path, or `local` for this `RUN_ID`'s run)

| Command | Secrets (testnet) | Effect |
|---|---|---|
| `deploy <local\|testnet> [--merchant-delay <s>]` | `TESTNET_L1_PRIVATE_KEY`, `TESTNET_DEPLOYER_SECRET`, `SEPOLIA_RPC_URL`; plain `TESTNET_ADMIN_ADDRESS` | deploy L1 then L2, wire them, propose both handovers, write the manifest |
| `admin address` | `TESTNET_ADMIN_SECRET` | print the admin account's address |
| `admin accept <manifest>` | admin | deploy the admin account through the sponsor if needed, then accept bridge ownership and the merchant admin role, and record it as the manifest's `l2.admin` |
| `admin propose <manifest> <address>` | admin | propose both handovers to a new admin (the switch away from an interim admin) |
| `disposable init` / `exec <command…>` / `destroy` | none; `exec` reads the disposable file | the P9 fallback (below): create the keys, run one `bridge` command with them, delete them |
| `merchants add <manifest> <acct…>`, `off`, `on`, `delay <s>`, `guardian <addr>` | admin | list operations; `delay` sets the value and syncs every added merchant in as few txs as the per-tx call limit allows. Up to that limit the entries share one change time; beyond it they fall into a few cohorts instead of one per merchant |
| `merchants cancel <manifest> <acct>` | admin or guardian | cancel a pending change |
| `merchants list <manifest>` | none | status of every added merchant, from `MerchantAdded` events |
| `pause <manifest> <on\|off>` | admin | bridge pause |
| `verify <manifest> [--tour <file>] [--node <url>] [--l1-rpc <url>]` | none | strict read-back (below); `--tour` also checks the tour's schema and identity |
| `smoke <manifest> [--record <file>]` | none (the demo cast) | the acceptance run, including refusals |
| `export <manifest> --out <dir>` | none | the integration bundle |
| `manifest-path local` | none | print this `RUN_ID`'s manifest path (run ids carry a checkout hash, `handle.ts:22-26`) |
| `demo setup [--rotate]` / `status` / `reset <manifest>` | none | `setup`: draw the users' tag (`--rotate`: a new one), deploy the cast's accounts, bind both users, and seed the L2 float with keyless A_demo deposits (a private deposit Alice claims, a public one Galactica claims). On local it first funds A_demo and B_demo from anvil's public dev account and lists the merchants. `status`: the floats and the cast's addresses. `reset`: rebalance with merchant→user refunds |
| `demo fund <manifest>` | `TESTNET_L1_PRIVATE_KEY`, `SEPOLIA_RPC_URL` | refill A_demo's and B_demo's ETH and USDC, approve Permit2, top up the sponsor |
| `probe testnet`, `scan secrets` | as today | as today |

**Strict `verify`**, keyless:
- L1 bytecode against a fresh build (`bytecode_hash = "none"` from P4, so comment edits don't change bytes);
- every binding (portal ↔ router ↔ bridge ↔ proxy ↔ token), with minter == proxy and `auth_contract == 0`;
- the handover complete and nothing pending;
- every merchant's delay, and the guardian slot's, equal to the setting;
- the token's `total_supply` no higher than the portal's USDC. This is necessary, not sufficient: unclaimed deposits and unredeemed exits and returns are liabilities too, and integration asserts the full equation;
- demo-cast accounts listed only on `local` and `testnet` manifests.

`verify` trusts the endpoints it reads through: the manifest's node and the pinned public L1 RPC, unless `--node` and `--l1-rpc` name the operator's own. `operations.md` says to use your own.

**Local admin.** `deploy local` hands over to a fixed public `LOCAL_ADMIN_SECRET` and accepts in the same command, so the local handover path runs every time. The integration harness and `demo setup local` sign as that admin.

**Keyed-run templates** (committed; refs are `op://Keyed-Runs/InferenceMoney-Testnet/<VAR>`):

| Template | Variables |
|---|---|
| `deployments/testnet-deploy.env.example` | `# op: import` TESTNET_L1_PRIVATE_KEY · `# op: generate fr` TESTNET_DEPLOYER_SECRET · `# op: import` SEPOLIA_RPC_URL · plain TESTNET_ADMIN_ADDRESS (committed after the admin-address run) |
| `deployments/testnet-admin.env.example` | `# op: generate fr` TESTNET_ADMIN_SECRET |
| `deployments/testnet-fund.env.example` | TESTNET_L1_PRIVATE_KEY · SEPOLIA_RPC_URL |

The deploy run never sees the admin secret, and the admin run never sees the L1 key.

**The keyed-run recipe** (the one authoritative copy; P9, P15 and the seeds follow it). env-exec runs the command in the checkout that filed the request, and accepts any commit that is a branch tip on the remote (its `keyed_pin`). So keyed runs execute from a dedicated worktree, never the working checkout, and later edits or pushes can't reach an approved run.
1. Commit, `gh stack push`, then `bash scripts/keyed-worktree.sh sync` (P8). It moves a detached worktree at `~/.cache/inference-money/keyed` to the pushed HEAD, pushes that commit as branch `keyed/testnet`, and installs keylessly with `bun install --frozen-lockfile --ignore-scripts`. So no install script, root `prepare` included, ever runs with a secret in its environment. `keyed-worktree.sh remove` deletes the worktree and the branch.
2. File `env-exec request` from that worktree. Every chain has the shape `bash -c '<scan-trap>; <commands>'`, where `<scan-trap>` is `trap "s=\$?; bun run secrets:scan || s=1; exit \$s" EXIT`. The scan takes its needles from the environment and runs even when a command failed.
3. Start `env-exec wait <id>` in the background and print the exact `op-remote <host> <id>` line for the owner.
4. While the run is live, this session only edits files. It installs, builds, tests and commits nothing, because all of those run third-party code as the same user (the git hooks run Biome and commitlint through `bunx`), and that code can read the run's environment. Other same-user processes on the host can read it as well; that residual is accepted for testnet keys, and production keys never run on a shared host.
5. Once the run ends, copy its outputs into the working checkout and commit them.

**The disposable fallback** (the owner's decision of 2026-09-30, an exception to "no agent generates operational keys", for testnet only). It lets P9 run while the owner is away.
- `bridge disposable init` (P8) generates an L1 deploy key (viem `generatePrivateKey`), an L2 deployer secret and an interim admin secret (`Fr.random`). They go into `~/.cache/inference-money/disposable/testnet.env`, mode 0600, outside every checkout, and are never printed, logged or passed on argv. It prints only the addresses: the owner funds the L1 one at the faucets, once, whenever convenient. It refuses to overwrite an existing file.
- `bridge disposable exec <command…>` runs one `bridge` command with those values in the child's environment only. It uses the same redaction, the same `<scan-trap>` scan and the same rule of nothing else running while it's live, from the keyed worktree. It refuses a file that isn't 0600 and owned by this user. The agent never reads the file itself. The L1 RPC is the pinned public endpoint.
- Deploy keys lose every role at deployment (Least privilege), so only the admin role outlives the fallback. The manifest marks it `l2.interimAdmin`, and `verify` warns while that holds.
- **The switch**, once the owner is back:
  1. the keyed `admin-address` run;
  2. `bridge disposable exec admin propose deployments/testnet.json <owner admin>`;
  3. the keyed `admin accept`;
  4. `verify`;
  5. `bridge disposable destroy`.

  No redeploy. Delivery waits for the switch.
- Residual: the file sits on disk until the switch, readable by any same-user process for that whole time, not just during one run. That is accepted for testnet keys holding test funds.

**Showcase** (`apps/showcase`, design F)
- **Layout.** A header with the two modes. On the left, a composer (ACT AS / ACTION / TO / USDC / Try it, plus the Happy path and Try to cheat chips) and a stage: an Ethereum lane, four wallet cards and the coin. A verdict banner steps through Simulate, Prove, Send, Settle. On the right, the dark "What the world sees" feed.
- **Wallet.** One embedded PXE hosts all four accounts: one sync, one prover, one memory footprint. Its OPFS store is keyed by the bridge address, so a new deployment starts fresh. The prover mode comes from the build target: real proofs on testnet, fake ones in local e2e except in the `proving` project.
- **Tour.** The testnet build embeds the recorded tour and checks its identity against the manifest; local builds embed a fixture tour.
- **Ethereum lane.** A_demo makes live Permit2 deposits and finishes withdrawals while its float allows, and replays the recording when underfunded.
  - The L1 RPC is a committed public endpoint in the build target, never `SEPOLIA_RPC_URL`, which is a keyed secret. The CSP adds exactly that origin.
  - The build refuses to run with any keyed-run variable set, and a bundle assertion checks the origin.
- **Resilience.**
  - Pending deposit secrets, submission records and withdrawal tickets persist in `localStorage`.
  - An action that fails on a duplicate nullifier first reconciles its own submission: did it land? Only a proven conflict with another tx is re-simulated and retried once. A payment, burn or deposit is never re-sent blindly.
  - A reset chip is available.
  - An empty float falls back to replay.
  - A demo account's binding can't be reset. A poisoned user account is replaced by rotating the tag.
  - Payments go through `payments.ts`, so a visitor can't pay the same request twice from one browser.

### Critical paths

**Acceptance run** (testnet `smoke`, integration and local e2e):

| # | Step | Call | Proven | Public |
|---|---|---|---|---|
| 1 | A deposits 10 | `router.deposit(10, 0, secretHash, true, …)` → `portal.depositToAztecPrivateFor(A, 10, secretHash)` | Permit2 witness, signer A | L1: A, 10, private, secret hash, message index |
| 2 | Alice claims | `claim_private(alice, 10, salt, leaf, A, bind)`, with `bind` from `get_funding_address` (true only on a fresh account) | self-claim; message consumed; binds A or matches it | message nullifier; supply +10; on the first claim, the binding nullifier and note |
| 3 | Facilitator opens a request | `initialize_transfer_commitment(galactica, alice)` from galactica | `to` is a merchant at the anchor | validity nullifier + stamp |
| 4 | Alice pays 10 | `transfer_private_to_commitment(alice, c, 10, 0)` | settled `stamp(c)` | note nullifiers; completion log with 10 |
| 5 | Galactica refunds 3 | `transfer_private_to_private(galactica, alice, 3, 0)` | sender is a merchant | nullifiers and notes only |
| 6 | Alice pays Bob 1 | `transfer_private_to_private(alice, bob, 1, 0)` | refused at simulation | nothing leaves the device |
| 7 | Alice withdraws 1 to B | `exit_to_l1_private(B, 1, 0, nonce, false)` | refused: not the funding address | nothing |
| 8 | Alice withdraws 3 to A | `exit_to_l1_private(A, 3, 0, nonce, false)` → epoch proof → `portal.withdraw(A, 3, false, …)` | note address equals A | supply −3; L2→L1 content; L1: A receives 3 |

Expected deltas on a run: Alice 0, galactica +7, A's USDC −7, portal reserve +7. The smoke asserts deltas, not absolute balances, so it runs the same on a fresh cast and on a repeat run (`bind=false`).

**Returns**
- **Private.** Alice is bound to A and receives a deposit from C.
  1. `claim_private` refuses with the funding-address rule.
  2. `return_deposit_private(…, C)` emits `withdraw(C, amt, 0)`.
  3. After the epoch proof, anyone calls `portal.withdraw(C, …)`. Supply doesn't change.
- **Public.** A public deposit is made out to user Bob.
  1. `claim_public` refuses.
  2. `return_deposit_public` passes `!is_merchant(bob)` and pays the depositor back.
- A claim and a return compete for one message nullifier, so at most one succeeds.

**Switching a merchant off, delays, emergency**
- **Switch-off.** `merchants off <m>` schedules the change for now + D (24 h by default). Until then m is still a merchant, and each proof that reads m expires at `change − 1`. After D, m is a user.
- **Delay change.** `merchants delay <s>` sets the value, then syncs each merchant.
  - A decrease applies after old − new: 24 h → 1 h takes 23 h, and the merchant's txs are recognisable meanwhile.
  - An increase applies at once. That is upstream's rule (`scheduled_delay_change.nr:55-111`); raising the delay can only slow switch-offs. The explainer's "a later change is itself scheduled, never instant" holds for decreases only; the docs and the ELI5 say so, and Ask 9 asks whether to keep it.
- **Cancel.** `merchants cancel <m>` (admin or guardian) re-schedules the current value. The entry stays marked until the new change time.
- **Emergency.**
  1. `pause on`: instant; blocks new L2 claims, exits and returns.
  2. `merchants off <m>`.
  3. Wait D.
  4. `pause off`.

  The pause is L2-only:
  - token transfers on Aztec continue;
  - withdrawals already emitted stay redeemable on Ethereum (`TokenPortal.withdraw`, `TokenPortal.sol:139-165`, has no pause);
  - L1 deposits stay open, and their messages wait for the unpause.

  So it stops a bad merchant's new cash-outs, but not one already in flight or its payments on Aztec. P7 tests a redemption during a pause.

### File-level change map (recon rows in brackets)

**Added**
- `contracts/aztec/token/` [C4, C5]:
  - `Nargo.toml`, `LICENSE` (upstream MIT);
  - `src/main.nr` (the verbatim copy, then the merchant surface) and `src/hints.nr`;
  - `src/test/**` (the upstream suite plus `merchants.nr`, `rules_private.nr`, `rules_requests.nr`, `hints.nr`);
  - `txe-manifest.txt`;
  - `target/merchant_token-Token.json`.
- `contracts/aztec/{merchant_stamp,portal_messages}/` [C1, C2].
- `contracts/aztec/token_bridge/src/{funding_address_note.nr, test/binding.nr, test/returns.nr}` [C5, C7].
- `contracts/aztec/scripts/abi-superset.test.ts`.
- `packages/bridge-core/src/{merchants,payments,return,stamp,rules,signing-key}.ts`, with tests [C9].
- `packages/demo/` [C15] and `.github/workflows/demo.yml`.
- `scripts/keyed-worktree.sh`.
- `packages/integration/test/{merchants,transfers,requests,binding,exit-rules,returns,operator}.test.ts` [C13].
- `deployments/testnet-{deploy,admin,fund}.env.example` [C12], `deployments/testnet-demo.json` and `deployments/testnet-tour.json`.
- `apps/showcase/src/{demo,tour,ui}/**` [C14, C17].
- `apps/showcase/e2e/specs/{tour,try-happy,try-cheat,resilience,proving}.spec.ts`, `e2e/fixtures/tour.json` and `playwright.testnet.config.ts` [C18].
- `.github/workflows/showcase.yml` (from `web.yml`) [C19].
- `docs/operations.md` and `docs/integration.md`.

**Modified**
- `contracts/aztec/`:
  - `token_bridge/**` and `token_minter_proxy/{Nargo.toml,target/*}`;
  - `claim_secret/src/lib.nr` (comment only: private claims are no longer relayable);
  - `keystone/**`;
  - `scripts/{compile.sh,run-txe-tests.sh,check-sole-consumer.sh,noir-deps.sh,artifact-identity.test.ts}`;
  - `package.json`.
- `contracts/evm/`:
  - `src/{TokenPortal.sol,Permit2DepositRouter.sol,interfaces/*}`;
  - `test/**`: ContentHash, PortalRoundtripFuzz, RouterFixture, TokenPortal, router, invariants, SepoliaFork, FormalPortal, FormalRouter, Mutants, mocks;
  - `scripts/halmos-gate.sh`, `.gas-snapshot`, `foundry.toml` (`bytecode_hash = "none"`) [C1, C2, C8].
- `packages/bridge-core/src/{content-hash,claim,deposit,exit,artifacts,manifest,instances,index}.ts` [C1, C9].
- `packages/deployer/src/{cli,secrets,redact,scan,deploy,deploy-l1,deploy-l2,testnet,verify,smoke,budget,local,wallet}.ts` [C10, C11].
- `packages/integration/test/{deposits,exits,guards,harness}.ts`.
- `apps/web` → `apps/showcase`: `build/target.ts`, `vite.config.ts`, `wrangler.jsonc`, `e2e/**`, `package.json` [C16, C18].
- `.github/workflows/{_e2e,deployer}.yml` (path filters gain `packages/demo/**`), `biome.json`, root `package.json`, `bun.lock`, and the three `bunfig.toml` files (release-age exclusions dropped).
- `AGENTS.md`, `docs/{architecture,assurance-map,ci-pipeline,roadmap}.md`, `deployments/testnet.json` [C20].

**Deleted**
- `packages/deployer/src/spike.ts` and its script.
- `.github/workflows/web.yml`.
- The npm `@aztec-foundation/aztec-standards` runtime dependency. TXE may keep it for the upstream test contracts' artifacts.
- `token_portal_content_hash_lib`, and the aztec-node row in `noir-deps.sh` once nothing uses it.
- In the showcase:
  - the connect surface (`src/components/L1Connect.tsx`, `src/components/aztec/*`, `src/wallet/*`);
  - `e2e/test-wallet/*` and its specs and fixtures;
  - the wagmi and wallet-sdk dependencies.

### Non-obvious mechanics

1. **Expiry.**
   - The kernel caps every tx at `anchor + 86399`, the instance registry's update horizon: `MAX_TX_LIFETIME` and `DEFAULT_UPDATE_DELAY` are both 86400 (aztec-packages protocol `types/src/constants.nr:202,1333`), and the kernel takes the minimum (`private_kernel_circuit_output_composer.nr:158-190`).
   - A DPM read with D = 86400 and nothing pending sets the same cap, so merchant checks blend in. This is an inference; A21 pins it by comparing expiry with a non-reading tx at the same anchor.
   - A pending change sets `change − 1`.
   - D = 3600 sets `anchor + 3599`.
   - **Measured in P3:** these are in-circuit caps. The PXE commits each one rounded down from the anchor, to whole hours, else half hours, else seconds (`compute_tx_expiration_timestamp.js`). Every tx with a 24 h horizon commits `anchor + 82800`, merchant check or not, so parity holds. D = 3600 commits `anchor + 1800`. ([lessons](lessons/phase-3.md))
2. **`InitialDelay = 3600`, then `schedule_delay_change(setting)` at add.** Raising from the floor always applies at once, so a new merchant starts with the configured delay. A compile-time 24 h would make a later 1 h setting take 23 h for every new merchant. The guardian slot gets the same call in the constructors.
3. **Cancels and switch-ons still mark.** Any schedule sets `change = now + D`, and reads of that entry stay marked until then.
4. **Hints and flags are advice.** Every branch is fully constrained. `try_prove_merchant`'s `false` is only used to refuse.
5. **TXE runs no kernel.** Nullifier-existence requests and note reads are not validated there. The stamp check adds the same `check_nullifier_exists` pre-assert aztec-nr uses. Refusals enforced only by the kernel, and expiry, are asserted at integration, where the PXE simulates the kernels.
6. **Stamps settle first, for private payments.** A private payment proves the stamp at its anchor, so it can be made only after the opening tx is mined, like upstream's private completion, which reads the validity commitment `for_settled` (`uint_note.nr:226-231`). `transfer_public_to_commitment` checks the stamp with `nullifier_exists_unsafe`, like upstream's public `complete` (`:200-202`), and needs no settled anchor.
   - Completion is not single-use, and the recipient discovers only the first completion, so a second payment is lost (`uint_note.nr:183-188`). `payments.ts` refuses a second payment from the same client, and integration pins the on-chain behaviour.
   - A request stamped while its recipient was a merchant stays payable after that merchant is switched off. The explainer states this; a test pins it.
7. **Delivering the binding note inside a branch.** `initialize(...)` returns a `NoteMessage` that must be delivered inside the `if`. If that doesn't compile, the fallback is the hint shape of `private_mutable.nr:217-245`.
8. **Sole-consumer guard v2.** It expects exactly four `consume_l1_to_l2_message` sites:
   - both private sites derive their secret with `derive_claim_secret`;
   - returns pay the depositor from the consumed content and never mint;
   - the message sender is `config.portal`.

   New mutants, on top of the 15 existing ones:
   - a return paying the caller or the recipient;
   - a return that mints;
   - a raw secret on the private return;
   - a foreign sender;
   - a fifth site;
   - `claim_public` without the merchant guard;
   - `claim_private` without the self-claim check;
   - a `!bind` claim that skips the binding equality;
   - a user exit that skips the funding-address check;
   - an `as_merchant` branch that ignores `try_prove_merchant`'s result;
   - `exit_to_l1_public` without its merchant check.
9. **No private rule check enqueues a public call**: one would publish the checked address. This becomes an AGENTS.md rule.
10. **Binding races.** Two first claims from different depositors can both simulate. Only one lands; the other becomes a return.
11. **Rollbacks.** Artifacts are checked against HEAD, so commit the rebuild before `compile.sh --check`. Reverting source doesn't revert deployed contracts: a fix that changes class ids needs a new deployment.
    - Before a redeploy, the old deployment's open tickets are settled with the current CLI. Anything left is finished later from a worktree at its manifest's `sourceCommit`.
    - Arcs 2 and 3 revert only as whole arcs. P4 changes L1 formats that only P5 mirrors on L2 and in TS, and P6 changes the bridge ABI that only P7 adapts. So the gates of P4 and P6 prove one toolchain each, and cross-toolchain consistency is proven at P5 and P7.

### Trade-offs and alternatives not taken

| Alternative | Why not |
|---|---|
| Separate merchant registry behind the token's `auth_contract` (strict ABI identity) | One extra private call per restricted transfer (the DPM must be read by its owner), plus the ARC-403 hook call. The ABI superset keeps every upstream signature. |
| ARC-403 hook as the rule engine | Its interface is `(from, amount, selector)`, with no `to`. |
| Instant public switch-off | Rejected with the user: a public check at inclusion names the merchant on every payment. |
| Marker nullifier instead of `PublicImmutable` register | Saves one historical read (about 4k gates) per check, but hand-rolls what `PublicImmutable.read()` already does: an oracle pre-check that TXE sees, plus the kernel's existence request (`public_immutable.nr:317-337`). Kernels dominate the proof, so the standard state variable stays, and its value is asserted. |
| Side as an explicit parameter | Changes upstream signatures, which the ABI superset forbids. A transient capsule carries the side without touching the ABI. |
| On-chain single-use payment requests | Changes an upstream function's behaviour, and adds a nullifier to every payment. The loss is the payer's own repeat submission, which `payments.ts` refuses. |
| Batched on-chain delay-change proposals | Needs cursors, snapshots and lifecycle state for a rare admin action. A set, then admin-driven per-entry syncs, reaches the same end state. |
| An on-chain notice period for delay increases | An increase only slows switch-offs. Upstream applies it at once, and the docs correct the explainer instead. |
| No guardian | Only the possibly compromised admin could cancel a malicious switch-off, for example of the facilitator. |
| One `return_deposit` taking a raw secret for both kinds | A public claim exposes its secret in the mempool, so a copied return could bounce a merchant's deposit. The private return never sees a raw secret. |
| Returns open while paused | The explainer's pause "blocks every deposit and withdrawal", and a return is a withdrawal to Ethereum. The L2 pause can't reach transfers on Aztec, withdrawals already emitted or L1 deposits (emergency path), so the docs and the ELI5 correct the explainer on those. |
| One-shot `setRouter` | An extra privileged call with an ordering hazard. The binding is checked at `initialize`. |
| Recorded-only Ethereum lane | Loses the live L1 story. Bounded exposure of test assets with a replay fallback costs little. |
| One PXE per actor (the brief) | Four syncs, four provers, four times the memory (Ask 10). |
| Dropping public deposits | Merchants need public funding, and returns make mistakes recoverable. |
| Automatic CI e2e on every PR | The suite deploys contracts and runs for about an hour. It stays opt-in by label, and delivery requires it green. |

## Security & Adversarial Considerations

**Threat model**

| Actor | Attack | Stopped by | Residual |
|---|---|---|---|
| User | user→user through any private entry; public→private to self | rule check at the anchor; hints can't lie usefully | users can't self-shield or unshield (documented) |
| User | open a request for itself; pay into an unstamped request | `Request refused` / `Payment refused` | stale stamps (mechanics 6) |
| User | withdraw to another address; exit publicly | exit rules | – |
| User or relayer | claim someone else's private deposit | `msg_sender == recipient` plus the derived secret | – |
| User | re-bind an account; forge a binding | the init nullifier derives from the owner's `nhk_app` | – |
| Gifter | bind a fresh account to the gifter's address | only the recipient claims; a first-claim warning; the return path | an account that claims a gift first is bound to the gifter |
| Gifter | take back an unclaimed gift | a depositor holding the claim data can return it before the recipient claims | documented: a deposit is final only once claimed |
| Front-runner | copy a merchant's public-claim secret into a return | `!is_merchant(to)` | – |
| Front-runner | redirect a router deposit; name a victim as depositor | Permit2 owner is `msg.sender`; `…For` is router-only | – |
| Merchant | open a request for Carol payable by Bob | a stamp only when `to` is proven a merchant | – |
| Merchant | act as a mixer for users; pay anyone; exit anywhere | curation of the list; switch-off; the pause | inherent to the role; key custody is Galactica's control |
| Compromised admin | rogue instant add; malicious switch-offs; delay decreases; guardian replacement; pause DoS; handing the role to itself | multisig; decreases and guardian replacement wait D; a switch-off is public for D, and the guardian can cancel it | a rogue merchant is live at once (Ask 1); an instant delay increase (at most 86400) slows later switch-offs (Ask 9); the two-step handover is instant and not cancellable, so a compromise can be made permanent, including a pause that freezes exits (Ask 11) |
| Compromised guardian | cancel legitimate switch-offs repeatedly | the admin schedules a replacement | removals delayed by at most D |
| Sequencer | include a stale merchant proof after a switch-off | DPM expiry | targeted censorship of recognisable txs (1 h delay, pending changes) |
| Slow device at D = 1 h | a merchant-proving tx must be proven and included within 1 h of its anchor | P10's proving budget (at most 240 s on 2 CPUs) | a liveness cost of the 1 h option (documented) |
| Payer | pay the same request twice | `payments.ts` refuses a commitment it has paid or is paying | two devices paying one request; the second payment is lost (upstream) |
| Showcase visitor or bot | drain the float with public keys; sweep A_demo; spam the sponsor; bind a cast account first | bounded testnet float; replay fallback; refill run; strict CSP; no user content rendered as HTML; users' secrets take a tag drawn and bound in `demo setup` | demo downtime only |
| Malicious RPC, node or manifest | wrong identity, forged receipts, malformed fields; watch queries | proofs and kernels trust no endpoint; zod schemas; identity checks at build; messages reconstructed locally | `verify` and the page's reads trust their endpoints (operators pass their own); the node learns which merchant each proof reads (privacy ledger); denial of service |
| Supply chain | poisoned npm, Noir or forge dependency | `toolchain.json` pins; `noir-deps.sh` exact commits (`--exact` in CI); fork copied from a pinned commit; frozen lockfile; 7-day release age, with the Aztec exclusions dropped in P1; pinned forge-std; keyed installs skip install scripts | – |

**Privacy ledger** (documented in `docs/integration.md`, not fixed)
- **Visible:**
  - Ethereum shows that A deposited and later withdrew, with amounts.
  - Aztec shows claim and withdrawal amounts (total-supply writes) and payment-request amounts (completion logs).
  - A return mints nothing and shows no amount on Aztec, but its redemption on Ethereum shows recipient and amount, which a public deposit links back to.
  - The merchant list is public.
  - Enqueued pause checks reveal bridge use.
  - A first claim is distinguishable.
- **Inferable from the rules:**
  - A private↔public transfer whose public side isn't a listed merchant has a merchant on its hidden side.
  - An L1 withdrawal to an address that never deposited is a merchant's.
  - Anyone who knows `c` can tell stamp from pad, and so whether a request was opened for a merchant. Every payer knows `c`, and `transfer_public_to_commitment` publishes it.
- **Linkable:**
  - A pending change links that merchant's txs until it takes effect.
  - With D = 1 h, merchant-proving txs are recognisable by expiry.
  - Delay syncs spread over several blocks would give each merchant its own expiry for up to 23 h. The CLI batches them, which leaves one cohort up to the per-tx call limit and a few beyond it.
- **Your node**, the one your wallet queries, learns which merchant each proof reads (its register nullifier and switch-off slot) and, when you pay a request, its stamp.
  - With the SDK's capsule, the merchant check tells it nothing about your own address.
  - A wallet without the capsule probes the counterparty first, which can reveal the user on the other side of a merchant's transfer.
  - Running your own node keeps this from third parties.
- **Hidden:** direct private transfers show only counts, and at D = 24 h their expiry equals the default. Stamp and pad publish the same count.

**Least privilege**
- **Deploy keys.** The L1 key's only power ends at `initialize`. The L2 deployer proposes both handovers, the proxy owner is inert once wired, and `verify` fails if a deploy key keeps a role.
- **Keyed runs** are split by role and run from a dedicated worktree installed without secrets or install scripts.
- **CI** holds no secrets and gets `contents: read`.
- **Workers Builds** pulls from GitHub; no Cloudflare token lives in GitHub.
- **Demo keys** never hold an admin or minting role, and are merchant-listed only on local and testnet deployments.
- **The guardian** can only cancel.
- **Disposable fallback keys** exist only if the owner is away at P9. They hold testnet funds and, until the switch, the interim admin role; then they are destroyed.

**Cryptography**
- Protocol primitives only: poseidon2, with separators derived like `claim_secret`'s; sha256 and keccak through the Aztec `Hash` library and the pinned noir-lang crates (sha256 v0.3.0, keccak256 v0.1.3); viem.
- On L1: Permit2, OpenZeppelin SafeERC20 and ReentrancyGuard.
- Accounts are Schnorr.
- No hand-rolled signature, KDF or encryption.

**Input validation**
- **L1:** the u128 cap, exact pulls and debits, router-only `…For`, and the router/token match at init.
- **L2:**
  - `amount > 0`;
  - non-zero recipient and depositor;
  - admin checks (zero or duplicate add, delay bounds, pending-only accept);
  - message content binds `to`, amount and depositor.
- **TS:** zod on the manifest and the tour; preflights before signing or proving; CLI argument parsing.
- **Secrets:** a missing variable is reported by name only.

**Domain risks**
- **Reorg or prune:** a pruned claim takes its binding with it, and the owner's re-claim binds the same depositor. Demo accounts are the exception, since anyone holding their public keys could claim first, which is why `demo setup` waits for finality.
- **Replay:** stopped by message nullifiers, single-use Outbox consumption, per-commitment stamps and `authorize_once`.
- **A blacklisted or lost funding address:** only a merchant cash-out route remains (documented).
- **A rollup upgrade** strands the portal (existing follow-up).

## Assumptions

**Facts**
- **Router and portal**
  - The router's constructor requires an initialized portal (`Permit2DepositRouter.sol:50-58`).
  - The Permit2 owner is `msg.sender` (`:85`), and the portal sees the router (`:93-95`).
  - The deployer deploys the router after `initializePortal` (`deploy.ts:43-45`).
  - `TokenPortal.withdraw` has no pause (`TokenPortal.sol:139-165`).
  - Content encodings are at `TokenPortal.sol:92-93,118,152-155`, and `_pullExact` pulls from `msg.sender`.
- **Bridge**
  - It consumes messages at `token_bridge/src/main.nr:96,116`.
  - `claim_private` derives the secret from `recipient`, and any caller may submit it (`:100-123`).
  - The pause check is enqueued from private (`:84-88`).
- **Content hash:** `token_portal_content_hash_lib` is an aztec-node git dependency pinned at `68274e7c` (`noir-deps.sh:19`).
- **Upstream token** (aztec-standards v6.0.0-rc.1 `token_contract/src/main.nr`)
  - Storage is at `:53-63`.
  - `transfer_private_to_public_with_commitment` opens the commitment for `to`, with completer `msg_sender` (`:148-166`).
  - `transfer_private_to_commitment` has completer `msg_sender` (`:198-215`); `initialize_transfer_commitment(to, completer)` is at `:244`.
  - The private mint and burn enqueue public supply updates (`:692,712`).
  - ARC-403 gets `(from, amount, selector)` (`:525-547`).
- **aztec-nr**
  - `DelayedPublicMutable`: minimum delay 3600 (`delayed_public_mutable.nr:16`); `InitialDelay` is a type parameter with a static assert (`:139-145`); scheduling uses the slot's current delay, which is `InitialDelay` until one is scheduled (`:203-208`); a private read reads `this_address` and caps expiry (`:519-559`).
  - Increases apply at once and decreases wait old − new (documented at `delayed_public_mutable.nr:225-289`; implemented in aztec-packages protocol `types/src/delayed_public_mutable/scheduled_delay_change.nr:55-111`).
  - `PublicImmutable`'s private read runs an oracle pre-check, pushes a nullifier-existence request, then reads the value historically (`public_immutable.nr:317-337`).
  - `PrivateImmutable`'s init nullifier uses `nhk_app(owner)` (`private_immutable.nr:66-100`).
  - Private completion reads the validity commitment `for_settled` (`uint-note/src/uint_note.nr:226-231`); public `complete` uses `nullifier_exists_unsafe` (`:200-202`). Completion is not single-use, and the recipient discovers only the first (`:183-188`).
  - `#[authorize_once]`'s checks are prepended to the function body (`macros/internals_functions_generation/external/private.nr:173-181`).
  - Transient capsules ride on the tx request and match on contract, slot and scope. The zero scope is always allowed (`@aztec-labs/pxe` `storage/capsule_store/capsule_service.js:11-25`), and the class registry loads its bytecode that way (`contract_class_registry_contract/src/main.nr:77-81`).
- **Deployer**
  - `verify` loads secrets to learn the L1 deployer, and takes its L1 RPC URL from them when set (`packages/deployer/src/testnet.ts:44-48,106-112`).
  - Secrets are read from `.env.testnet` (`secrets.ts:93-97`), which is absent on this host. `scrubbedEnv` already strips credential-carrying variables for child processes (`secrets.ts:57-59`).
  - `verify` compares full runtime bytecode with immutables masked (`verify.ts:35-42`), and `foundry.toml` keeps the default metadata hash, so today a comment edit breaks it.
- **Tests that pin today's open paths:** `packages/integration/test/deposits.test.ts:42-50` (a relayed private claim), `exits.test.ts:44,89` (a user's public exit), `token_bridge/src/test/claims.nr` (`claim_public_by_relayer_credits_the_recipient`), and assurance cells A1 and A4.
- **Web and CI**
  - The in-browser test wallet runs with `proverEnabled: false` (`apps/web/e2e/test-wallet/wallet.ts:35`).
  - The CSP `connect-src` holds `'self' data: blob:` and the node origin (`apps/web/build/target.ts:70`).
  - CI e2e is opt-in by the `e2e` label (`web.yml:72`).
- **Keyed runs:** a run refuses a dirty, untracked or unpushed tree and pins the pushed commit. It runs in the requesting checkout, and the pin accepts any commit that is a branch tip on the remote (`env-exec`'s `keyed_pin`). Values are single-line, 8–4096 bytes, and `generate fr` exists for Aztec secrets.
- **Supply chain:** the three bunfigs exempt the Aztec release from the 7-day gate until 2026-09-30T20:10Z (`bunfig.toml:7-9`), and the root `prepare` script runs husky (`package.json:22`).
- **Vectors:** the content-hash table was recomputed with viem, and the method reproduces today's pins.

**Inferences** (verify in the named phase)
- **I1 (P1):** the verbatim copy compiled here reproduces the npm class id `0x24c34002…1505`. Fallback: an identical ABI plus a green upstream suite, with the artifact diff recorded.
- **I2 (P3):** pointing the proxy's `token` dependency at the fork leaves the proxy's class id unchanged. `compile.sh --check` decides.
- **I3 (P2/P6):** a private `#[view]` may do DPM reads, since setting expiry isn't a side effect. Fallback: `self.call`.
- **I4 (P6):** a conditional `initialize(...).deliver(...)` compiles (mechanics 7).
- **I5 (P2):** the fork's public bytecode stays at or under about 2,700 fields; upstream is about 705.
- **I6:** a merchant check's two reads (about 8k gates) are small next to the kernels. Nothing measures the check alone; P10 times whole actions.
- **I7 (P2):** TXE `OracleMock` can mock the capsule oracle (`aztec_utl_getCapsule`) and the probes, so tests drive both hint paths and make each lie.
- **I8 (P9):** `op-remote create` on a later template adds its fields to the existing item. Otherwise the owner adds them by hand.
- **I9 (P9):** the testnet SponsoredFPC can be topped up through the FeeAssetHandler faucet (lessons.md).
- **I10 (P10):** in-browser proving meets P10's thresholds. If not, live mode simulates and shows the recorded proof.
- **I11 (P13):** Workers Builds deploys only after a successful build. While `main` still has `apps/web`, its builds fail once the root directory points at `apps/showcase`, and the last good deployment stays live.
- **I12 (P8):** an install with `--ignore-scripts` still runs the deployer, its PXE and real proving, because the native addons and `bb` ship prebuilt. P8's gate proves it from the keyed worktree with `verify`, `demo status` and one real-proof tx, before any secret is requested.
- **I13 (P3):** the PXE serves a tx's transient capsules to the token when an account entrypoint calls it. P3's integration exercises the capsule path end to end.

**Asks** (all answered 2026-09-30: 1–3, 5, 6 and 8 as recommended, the rest as marked)
1. **Instant adds (your decision).** Keep them. For production, Galactica can put adds through its multisig review. Delayed adds would drop the register and a read per check, but onboarding would take D.
2. **ABI superset instead of strict identity.** Every upstream function stays unchanged; merchant admin functions are added. Strict identity would cost one extra private call on every payment.
3. **Merchants bind on private claims too.** A merchant funding from several treasuries uses public deposits.
4. **A cancel-only guardian is built and left unset on testnet.** Without one, only the admin could cancel a malicious switch-off. Galactica can set one in production. **Answered: keep; a deployed token couldn't gain it later without a new token.**
5. **Testnet admin is one generated key.** Production uses Galactica's multisig account; `docs/operations.md` shows the handover.
6. **Demo exposure.**
   - A_demo and B_demo together hold at most 0.02 ETH and 50 test USDC, and the L2 float is at most 50 test USDC.
   - The testnet deployment lists public-key demo merchants, so its rules are bypassable by anyone reading the bundle.
   - The demo accounts keep nothing private: anyone can rebuild them from the page and read their notes. The feed is labelled as the public chains' view of equivalent production accounts.
   - `verify` refuses those merchants on any network other than local and testnet.
7. **You, during P9:**
   - Create the 1Password item `Keyed-Runs/InferenceMoney-Testnet`.
   - Import a funded Sepolia key holding test USDC, or fund a generated one.
   - Import `SEPOLIA_RPC_URL`.
   - Approve each keyed run with `op-remote`.

   **Answered: yes, plus a disposable fallback for when you're away** (the owner's exception to "no agent generates operational keys"; see "The disposable fallback" and P9). Fund its printed address once, any time before P9.
8. **You, before P13.** In Workers Builds:
   - point the root directory and build command at `apps/showcase`;
   - enable non-production branch builds, so the showcase branch gets a hosted preview URL.

   P13 and the hardening arc run against that hosted preview. Production switches at merge. If branch protection names `web-status`, rename it to `showcase-status`.
9. **Delay increases apply at once**, which is upstream's rule and contradicts the explainer's "never instant". Recommendation: keep it. A higher delay only slows later switch-offs, and it can't exceed 24 h. The alternative, a propose-then-apply step that waits the current delay, is about 10 lines of Noir plus tests; codex prefers it. **Answered 2026-09-30: apply at once.**
10. **One wallet engine (PXE) for the four demo accounts**, where the brief said one per actor. Recommendation: one. Four would mean four syncs, four provers and four times the memory in a visitor's tab. **Answered 2026-09-30: one.**
11. **The admin handover is instant** once the new admin accepts, and the guardian can't cancel it. Recommendation: keep it for this delivery, and list a delayed handover as a production follow-up.
    - A delayed handover the guardian can cancel is small (both the token's and the bridge's two-step handovers). It helps against a one-off compromise, such as one malicious transaction signed by the multisig, which today can move the role for good.
    - It doesn't help against a lasting compromise, which already controls everything the role does, the pause included.
    - **Answered 2026-09-30: keep instant; the delayed handover is a production follow-up.**

Already accepted, recorded for the audit trail: a request stamped while its recipient was a merchant stays payable after a switch-off. The explainer states this, and the user accepted it on 2026-09-30.

## Phases

Every phase commits its tests with its code, logs to `lessons/phase-N.md`, and leaves a clean tree. Artifacts are committed before `compile.sh --check` runs. Local networks use a phase-specific `RUN_ID` and are torn down in the same gate. Gates build `contracts/evm` before root `bun run test`, because bridge-core's `abi.test.ts` reads `contracts/evm/out` (`abi.test.ts:35-41`).

### Arc 1: merchant token

**P1. Verbatim fork baseline.** ✓ 2026-09-30 (class id equals npm's; [lessons](lessons/phase-1.md))

Work:
1. Copy aztec-standards `token_contract` at `cdfba943` into `contracts/aztec/token/`, byte for byte.
2. Name the package `merchant_token`.
3. Turn the upstream path deps into git deps at the same pinned tag: `arc403_interface`, `generic_proxy`, the test authorization contract, and aztec-nr `aztec`, `uint-note`, `balance-set`, `compressed-string`.
4. Add `LICENSE` and a provenance header.
5. `compile.sh` builds `token` first; commit its artifact.
6. `run-txe-tests.sh --crate token`: its floor is the measured upstream count. It stages the upstream test contracts' artifacts.
7. `test:noir` runs token, then bridge, then keystone.
8. `artifact-identity.test.ts` covers the token.
9. `abi-superset.test.ts` asserts an identical ABI and class id (I1).
10. Drop the release-age exclusion lists from the three bunfigs and AGENTS.md's release-age rule (the release cleared the gate at 2026-09-30T20:10Z), and delete that entry from `implementations-plan/follow-ups.md`.

Validation gate:
```
bun install --frozen-lockfile && (cd contracts/aztec/toolchain && bun install --frozen-lockfile) && (cd packages/local-network/toolchain && bun install --frozen-lockfile)
bash contracts/aztec/scripts/noir-deps.sh --self-test && bash contracts/aztec/scripts/noir-deps.sh && bash contracts/aztec/scripts/noir-deps.sh --verify
bash contracts/aztec/scripts/compile.sh --check
bun run test:noir && bun run --cwd contracts/aztec test
bun run lint && bun run typecheck
```
Pass:
- the token manifest is green at the upstream count;
- the bridge (48) and keystone (8) floors are unchanged;
- the ABI is identical;
- the class id equals npm's, or the difference is metadata-only and recorded.

Layers: Noir TXE, artifact identity.

**P2. Merchant list, rules, stamp.** ✓ 2026-09-30 (fork class id 0x06b1fbd1…84a2; soundness fix in self-review; [lessons](lessons/phase-2.md))

Work: build the token section in full, plus `merchant_stamp`, and summarize the delta in the provenance header.

Tests (TXE):
- **The upstream suite:** its setup lists the accounts it creates as merchants; any other edit is logged.
- **`merchants.nr`:**
  - admin-only calls; zero and duplicate adds;
  - an instant add;
  - a switch-off that takes effect after D and not before, and doesn't restart on a repeat;
  - switch-on as a cancel;
  - `cancel_merchant_change`: admin or guardian only, pending changes only, and refused when the scheduled value equals the current one;
  - delay bounds; an increase applies at once and a decrease waits; sync;
  - the two-step admin handover;
  - the guardian slot's delay is 86400 straight after construction, and a replacement or removal waits D;
  - the views.
- **`rules_private.nr`:**
  - user→user refused in all four entry points;
  - user→merchant, merchant→user and merchant→merchant allowed;
  - a switched-off merchant is a user after D and a merchant before it;
  - authwit paths are judged on `from`, and a delegated call without a valid authwit fails authorization first;
  - public→public is unrestricted.
- **`rules_requests.nr`:**
  - stamp versus pad;
  - Carol/Bob refused;
  - a merchant pays an unstamped request;
  - public commitment payments;
  - the `with_commitment` variant;
  - the stale-stamp residual pinned.
- **`hints.nr`:** a lying capsule and a lying probe each fail the proof; with no capsule, the probe checks the counterparty first and prefers a merchant with no pending change.
- **Keystone:** both separators, one stamp vector and the capsule slot.
- **`abi-superset.test.ts`:** upstream identical; the additions equal the list exactly; bytecode size (I5).

Validation gate: the P1 commands, plus
```
bash contracts/aztec/scripts/check-sole-consumer.sh --self-test && bash contracts/aztec/scripts/check-sole-consumer.sh
```
Pass: the token and keystone floors are raised to the measured counts, and every scenario above is green.

Layers: Noir, artifact.

**P3. Token wiring, integration, docs.** ✓ 2026-10-01 (I2 was wrong: proxy and bridge class ids re-pinned; commitments reach the opener through an offchain effect; arc 1 codex loop converged in 3 rounds; [lessons](lessons/phase-3.md))

Work:
- **Nargo:** the proxy and bridge depend on `token = { path = "../token" }`, and bridge TXE uses the fork's artifact.
- **bridge-core:** the fork's artifact (the npm dependency goes), re-pinned class ids, `stamp.ts`, `merchants.ts` (the bulk list and the side capsule), `payments.ts` (with the reuse refusal), and `rules.ts` with its drift test.
- **Deployer:**
  - deploys the fork;
  - `verify` checks minter == proxy, `auth_contract == 0`, the merchant admin and the guardian slot's delay;
  - `verify` reads slots from the artifact's storage layout, not literals.
- **Integration:**
  - `merchants.test.ts` [A20];
  - `transfers.test.ts` [A21]: kernel-validated refusals; the capsule path end to end (I13), a call without one, and a forged capsule failing at the kernel; expiry parity with a non-reading tx at the same anchor; `change − 1` while a switch-off is pending;
  - `requests.test.ts` [A22]: a missing stamp is refused; stamp and pad publish equal nullifier counts; a second payment into one request lands on-chain and never reaches the recipient (pinned), and `payments.ts` refuses to send it.
- **Docs:**
  - A20–A22 and A27 (ABI superset) in the assurance map;
  - the token section of `architecture.md`;
  - AGENTS.md rules: "the token stays an ABI superset, upstream storage first", and "rule checks are private reads, never public calls".

Validation gate:
```
bash contracts/aztec/scripts/compile.sh --check && bun run test:noir
bun run --cwd contracts/evm build && bun run lint && bun run typecheck && bun run test && bun run test:integration
RUN_ID=p3 bun run net:up && RUN_ID=p3 bun run deploy:local && RUN_ID=p3 bun run verify:local; s=$?; RUN_ID=p3 bun run net:down; test $s -eq 0
bun run --cwd apps/web test:components && bun run --cwd apps/web build:testnet
```
Pass:
- A20–A22 are green, including expiry parity and the pinned leak;
- the old app still builds.

Layers: Noir, TS unit, integration (PXE kernels), local deploy.

### Arc 2: depositor-bound messages

**P4. L1 portal and router.** ✓ 2026-10-01 (10 proofs; the fork suite re-pinned to the v6 rollup and tied to the deployer's pins; [lessons](lessons/phase-4.md))

Work: build the L1 section, and set `bytecode_hash = "none"` in `foundry.toml` so a comment edit after a deploy doesn't fail `verify` (the AGENTS.md Solidity rule says so).

Tests:
- `TokenPortal.t.sol`: router-only; direct deposits hash `msg.sender`; events; init mismatch and double init.
- Router tests.
- `ContentHash.t.sol`: the new literals.
- `PortalRoundtripFuzz` models the depositor.
- The `RouterFixture` and `TokenPortal.t` reconstructions.
- Invariant handlers for both deposit paths.
- Formal:
  - `FormalPortal.check_depositFor_rejectsNonRouter` with mutant `PortalWithoutRouterCheck`;
  - `FormalRouter.check_deposit_namesItsCallerAsDepositor` with mutant `RouterNamesItself`;
  - the init proofs include the router;
  - canaries for both;
  - `halmos-gate.sh` expects 10 pairs.
- `SepoliaFork`: portal → router → `initialize`.
- Regenerate `.gas-snapshot` from inside `contracts/evm`.

Validation gate:
```
bun run test:evm && bun run test:evm:formal && bun run test:evm:gas
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com bun run test:evm:fork
bun run lint
```
Pass:
- all 10 proofs pass, and each canary fails its own proof;
- the literals equal the table;
- the fork test deploys in the new order.

Layers: Solidity unit, fuzz, invariant, formal, fork.

**P5. L2 messages and TS.** ✓ 2026-10-01 (the bridge hashes through `portal_messages`; tickets carry the router event's depositor; [lessons](lessons/phase-5.md))

Work:
- **Noir:**
  - add `portal_messages`;
  - the bridge's claims gain `depositor`;
  - the keystone moves to the new lib, with 3 vectors and a depositor fuzz;
  - drop `token_portal_content_hash_lib`, and its `noir-deps.sh` row if `grep` finds no other user;
  - update the guard's shape checks.
- **TS:** `content-hash.ts`; `ClaimTicket.depositor` from the event; `claimCall`.
- **Deployer:** the order becomes portal → router → L2 → `initialize(…, router)`. `verify` checks `portal.router()` and the router's `PORTAL`, `TOKEN` and `PERMIT2`.
- **Old app:** adapted to the ticket shape.
- **Integration [A26]:** a router deposit names its signer; a claim naming another depositor fails to consume.
- **Docs:** the message formats in `architecture.md`.

Validation gate:
```
bash contracts/aztec/scripts/noir-deps.sh --self-test && bash contracts/aztec/scripts/noir-deps.sh && bash contracts/aztec/scripts/noir-deps.sh --verify
bash contracts/aztec/scripts/compile.sh --check && bun run test:noir
bash contracts/aztec/scripts/check-sole-consumer.sh --self-test && bash contracts/aztec/scripts/check-sole-consumer.sh
bun run test:evm && bun run lint && bun run typecheck && bun run test && bun run test:integration
RUN_ID=p5 bun run net:up && RUN_ID=p5 bun run deploy:local && RUN_ID=p5 bun run verify:local; s=$?; RUN_ID=p5 bun run net:down; test $s -eq 0
bun run test:e2e
```
Pass:
- the same three vectors in all three toolchains;
- the old web e2e is green. This is the last arc where it gates.

### Arc 3: bridge rules

**P6. Noir bridge.** ✓ 2026-10-01 (bridge floor 72, guard v2 with 32 mutants; [lessons](lessons/phase-6.md))

Work:
- Build the bridge section, guard v2 and the `claim_secret` comment.
- Pass `token` in `deploy-l2.ts` and re-pin the bridge's class id.
- Adapt the TS call sites to the new signatures, so bridge-core's unit tests still encode valid calls: `claimCall` passes `bind` and the exit passes `as_merchant` (`claim.ts:92`, `exit.ts:78`). The flows' logic waits for P7.

Tests:
- Rewrite `claims.nr`: a relayed public claim still credits a merchant; a user recipient is refused.
- Rewrite `claims_private.nr`: a relayed private claim is refused.
- `binding.nr`: the first claim binds; a match passes; a mismatch is refused; a wrong `bind` flag fails; there is no second binding.
- `returns.nr`: a return pays the depositor and never mints; a public return to a merchant is refused; a message can't be returned twice or after a claim.
- Exit rules in `exits.nr`, with both `as_merchant` branches.
- The pause covers returns.

Validation gate:
```
bash contracts/aztec/scripts/compile.sh --check && bun run test:noir
bash contracts/aztec/scripts/check-sole-consumer.sh --self-test && bash contracts/aztec/scripts/check-sole-consumer.sh
bun run --cwd contracts/evm build && bun run --cwd contracts/aztec test && bun run lint && bun run typecheck && bun run test
```
Pass:
- the bridge floor is raised to the measured count;
- the guard kills its 15 old mutants and every new one.

Layers: Noir, static guard, TS unit.

**P7. TS flows, integration, docs.** ✓ 2026-10-01 (integration 32 of 32, each rule spec on the books; [lessons](lessons/phase-7.md))

Work:
- **bridge-core:** claims with `bind`, preflights, `return.ts`, funding-address reads, `consumed-unknown`.
- **Integration:**
  - rewrite `deposits.test.ts:42-50` and `exits.test.ts:44,89`;
  - add `binding`, `exit-rules` and `returns` [A23–A25], including a return's L1 payout after the local epoch proof, a first-claim race, and a withdrawal redeemed on L1 while the bridge is paused;
  - the acceptance, returns and exit-rules specs end by asserting the whole liabilities equation: portal reserve = supply + unclaimed deposits + unredeemed exits and returns.
- **Old app:** typecheck and component tests stay green. Its e2e no longer gates; it goes in P10.
- **Docs:**
  - rewrite A1–A6 and add A23–A25;
  - the flows in `architecture.md`;
  - a first cut of `docs/integration.md`.

Validation gate:
```
bun run --cwd contracts/evm build && bun run lint && bun run typecheck && bun run test && bun run test:integration
RUN_ID=p7 bun run net:up && RUN_ID=p7 bun run deploy:local && RUN_ID=p7 bun run verify:local; s=$?; RUN_ID=p7 bun run net:down; test $s -eq 0
bun run --cwd apps/web test:components
```
Pass:
- the acceptance legs pass at the kernel level;
- every user row of the threat model is refused;
- a return leaves supply unchanged and pays its depositor on L1.

Layers: integration (kernels, L1 payout), TS unit.

### Arc 4: operator and testnet

**P8. CLI, keyed-run secrets, demo cast, local acceptance.**

Work:
- The CLI above, with root script `"bridge": "bun packages/deployer/src/cli.ts"`.
- Keep the `deploy:local`, `verify:local`, `probe:testnet` and `secrets:scan` aliases. Remove `deploy:testnet`, `verify:testnet`, `smoke:testnet` and the spike.
- Env-only secrets:
  - `loadTestnetSecrets` and every `.env.testnet` reference go;
  - `runRedacted` and `scan secrets` take their needles from the environment.
- The three templates, and `scripts/keyed-worktree.sh`.
- The manifest's `protocolVersion`, `sourceCommit`, `l1.deployer` and `l2.admin`.
- Strict keyless `verify`, with `--tour`, `--node` and `--l1-rpc`.
- `export`.
- `smoke` as the acceptance run with `--record`.
  - Its state is namespaced by deployment and run and locked, and it never discards another deployment's pending tickets.
  - It asserts deltas, so a repeat run on the same cast works.
- On local, every command that consumes an L1→L2 message (`demo setup`, `smoke`) runs its own block heartbeat (`startBlockHeartbeat`, `local-actors.ts:20-33`), since messages don't become claimable without traffic. Each beats from an account of its own, so heartbeats never race.
- `deploy local` hands over to the fixed public local admin and accepts it in the same command.
- `BRIDGE_PROVE=1` makes local commands prove for real (the local wallet doesn't by default, `local.ts:35`), so a keyed worktree's install can be proven before any secret is requested.
- The `demo *` commands, `manifest-path`, `admin propose`, and the `disposable` commands with the manifest's `l2.interimAdmin`.
- Last: run `bun run bridge disposable init` and give the owner the printed L1 address to fund at the faucets (up to 0.1 Sepolia ETH and 60 test USDC, within the budget).
- `packages/demo`; `signingKeyFor` moves to bridge-core.
- CI: `.github/workflows/demo.yml` in the per-package pattern; `packages/demo/**` joins the `deployer.yml` and `_e2e.yml` path filters.
- Update `budget.ts` and the probe.
- **Docs:**
  - `docs/operations.md`: every command; keyed-run recipes, including the keyed worktree; the 1 h option with its benefit and costs; the emergency path and what the pause can't reach; `verify` from the manifest's `sourceCommit` against your own endpoints; finishing an old deployment's tickets from its `sourceCommit`; demo refill and rotation (a new users' tag; merchants belong to the deployment, so nothing is re-listed);
  - AGENTS.md:
    - commands;
    - the secrets rule, rewritten for keyed runs: they run from the keyed worktree, installs skip scripts, and nothing is installed, built, tested or committed while one is live;
    - "no agent generates operational keys", with its one exception: the owner-authorized disposable testnet fallback of P9, generated in-process into a 0600 file outside every checkout, never printed, logged or passed on argv, and destroyed after the admin switch;
    - the demo-key carve-out: "derived in `packages/demo` from the deployment and a published users' tag, demo funds only, never an admin or minting role, merchant-listed only on local and testnet; agents may use them without a keyed run";
  - A28.

Tests:
- CLI parsing.
- The env loader: names only, never files or argv.
- Redaction.
- `verify` against each injected drift on local.
- An `export` round-trip into a fresh wallet.
- The tour schema and the world-view decoder.
- `demo setup` writes no tag until both binding claims report finalized (a stubbed status).
- The disposable file: created 0600 outside the repo and never overwritten; `exec` refuses looser permissions or another owner; no value reaches argv or output; `destroy` removes it.
- Integration of `smoke --record` on local.

Validation gate:
```
bun run --cwd contracts/evm build && bun run lint && bun run typecheck && bun run test && bun run test:integration
gh stack push && bash scripts/keyed-worktree.sh sync
k=~/.cache/inference-money/keyed
RUN_ID=p8 bun run net:up && RUN_ID=p8 bun run bridge deploy local && m="$(RUN_ID=p8 bun run --silent bridge manifest-path local)" && d="$(dirname "$m")" && RUN_ID=p8 bun run bridge demo setup local && RUN_ID=p8 bun run bridge smoke local --record "$d/tour.json" && RUN_ID=p8 bun run bridge smoke local && RUN_ID=p8 bun run bridge verify local --tour "$d/tour.json" && RUN_ID=p8 bun run bridge export local --out "$d/export" && bun run --cwd "$k" bridge verify "$m" && bun run --cwd "$k" bridge demo status "$m" && BRIDGE_PROVE=1 bun run --cwd "$k" bridge pause "$m" on && bun run --cwd "$k" bridge pause "$m" off; s=$?; RUN_ID=p8 bun run net:down; test $s -eq 0
bun run secrets:scan
```
From the keyed worktree, `demo status` reads private balances, so it runs a PXE, and the `pause on` is a real-proof tx signed by the keyless local admin. The last line is keyless, so it checks only that no wallet store was left on disk.

Pass:
- the acceptance run settles, including the L1 payout, and a repeat run on the same cast settles too;
- both refusals show the exact rule text;
- the tour validates;
- the export round-trips;
- every drift is caught;
- `verify`, `demo status` and a real-proof tx pass from the keyed worktree, whose install skipped scripts (I12).

Layers: unit, integration, local end to end.

**P9. Testnet, through keyed runs the owner approves one by one.**

Each request follows the keyed-run recipe (Off-chain surfaces); `<scan-trap>` is defined there.

1. Request the admin address:
   ```
   env-exec request --template deployments/testnet-admin.env.example --slug admin-address -- bash -c '<scan-trap>; bun run bridge admin address'
   ```
   Then commit `TESTNET_ADMIN_ADDRESS` into the deploy template and push.
2. Deploy, then fund A_demo and B_demo and top up the sponsor, which step 3's admin-account deployment relies on. It's one run, since both use the L1 key; the fund template stays for later refills:
   ```
   env-exec request --template deployments/testnet-deploy.env.example --slug deploy -- bash -c '<scan-trap>; bun run probe:testnet && bun run bridge deploy testnet && bun run bridge demo fund deployments/testnet.json'
   ```
   Then copy `deployments/testnet.json` into the working checkout, commit and push.
3. Deploy the admin account (sponsored), accept the handover, and list the demo merchants. Their addresses derive from the deployment, and the keyless `bun run bridge demo status deployments/testnet.json` prints them:
   ```
   env-exec request --template deployments/testnet-admin.env.example --slug admin-accept -- bash -c '<scan-trap>; bun run bridge admin accept deployments/testnet.json && bun run bridge merchants add deployments/testnet.json <galactica> <supplier>'
   ```
4. Keyless, in the background, from the keyed worktree so later edits can't reach it: `demo setup` draws the users' tag, binds both users and seeds the L2 float. Then the acceptance run follows (about 2 h, resumable):
   ```
   bun run bridge demo setup deployments/testnet.json && bun run bridge smoke deployments/testnet.json --record deployments/testnet-tour.json
   ```
   Then copy `deployments/testnet-demo.json` and the tour into the working checkout, commit and push, and run `bash scripts/keyed-worktree.sh remove`.

**If the owner is away.** When step 1's request isn't approved within 2 hours and the disposable L1 address is funded, P9 switches to the disposable fallback:
1. `bun run probe:testnet`, keyless;
2. `bridge disposable exec` for `deploy testnet`, `demo fund`, `admin accept` and `merchants add`, in that order;
3. step 4 as written.

Nothing else is filed with env-exec in the meantime, so no stale deploy request can run later. A late approval of step 1 only prints an address, which the switch then uses. Without that funding, P9 holds.

Validation gate (keyless):
```
bun run bridge verify deployments/testnet.json --tour deployments/testnet-tour.json
bun run bridge demo status deployments/testnet.json
bun run secrets:scan
test -z "$(git status --porcelain)" && git fetch -q origin && test "$(git rev-parse HEAD)" = "$(git rev-parse '@{u}')"
```
Pass:
- strict `verify` is green, the tour included;
- the smoke exited 0 with every leg settled, including the L1 withdrawal, and both refusals refused;
- the manifest, the demo tag and the tour are committed, and HEAD is pushed;
- if the fallback ran, `verify`'s only warning is the interim admin, and the switch is logged as pending in `lessons/phase-9.md`.

Layers: live testnet with real proofs, cross-chain settlement.

### Arc 5: showcase

**P10. Rename, strip, embedded wallet, proving harness.**

Work:
- `git mv apps/web apps/showcase` and rename the package.
- Delete the connect surface, the test-wallet transport, wagmi and wallet-sdk. Retire A16/A17 and the web parts of A11/A12.
- `src/demo/wallet.ts`: one persistent `EmbeddedWallet` with four accounts, the sponsor, and the prover mode from the build target.
- CSP: add the L1 RPC origin; `frame-src 'none'`.
- CI and config: `web.yml` → `showcase.yml`, whose path filter includes `packages/demo/**`; the `_e2e.yml` paths; the biome override; root `test:e2e`; `wrangler.jsonc`.
- **Proving harness:**
  - Playwright project `proving` and script `test:proving`, on a local network with real proofs;
  - it times a private transfer and an open-and-pay unconstrained and under a 2-CPU cgroup quota (`systemd-run --user --scope -p CPUQuota=200%`), and records peak memory (`performance.measureUserAgentSpecificMemory()`) and `navigator.hardwareConcurrency`. CDP CPU throttling isn't used, since it needn't slow the workers bb.js proves in;
  - it writes `test-results/proving.json`;
  - if the quota doesn't bind the browser's workers on this host, the constrained run moves to a reference laptop, and P10 asks the owner for it.
- **Decision rule:** live proving if the median is at most 90 s unconstrained and 240 s on 2 CPUs, and peak memory is at most 3 GB. Otherwise the build ships simulate-plus-recorded-proof. The decision goes in lessons and in this plan.
- **AGENTS.md:** remove the test-wallet grant rule, and update the layout, commands and the "one network per bundle" rule.

Validation gate:
```
bun run --cwd contracts/evm build && bun run lint && bun run typecheck && bun run test && bun run lint:actions
bun run --cwd apps/showcase test:components
bun run --cwd apps/showcase build:testnet && test -s apps/showcase/dist/_headers
bun run --cwd apps/showcase test:proving
```
Pass:
- no wagmi, wallet-sdk or `@aztec-labs/ethereum` in the showcase's dependencies or bundle (a bundle assertion);
- the CSP is exactly self, `data:`, `blob:`, the node origin and the L1 RPC origin;
- the proving numbers are recorded and the decision is taken.

Layers: component, browser real proving, build headers.

**P11. UI, design F.**

Work:
- **`ui/`:**
  - `Header` (modes);
  - `Composer`;
  - `Stage` (Ethereum lane, four wallet cards, `Coin`);
  - `Verdict` (Simulate / Prove / Send / Settle, with the rule text on refusal);
  - `WorldFeed`, labelled as the public chains' view of equivalent production accounts.
- **`demo/actions.ts`:** maps each step to bridge-core. On a duplicate nullifier it first reconciles its own submission, and re-simulates once only on a proven conflict with another tx. The reset chip is here too.
- **`demo/l1-lane.ts`:** live or replay, by balance.
- **`demo/tickets.ts`:** pending withdrawals in `localStorage`.
- **`tour/player.ts`.**
- **`build/target.ts`:** the testnet build embeds the recorded tour with an identity check (A18 extends to it); a local build embeds the fixture tour `e2e/fixtures/tour.json` without one, since a local deployment is ephemeral. Also `SHOWCASE_PROOFS=real|fake` and the P10 decision constant.
- **Copy** is reviewed like code: plain, no jargon, the rule text verbatim.
- **Component tests** (vitest; the wallet layer is faked, since bb.js doesn't run under jsdom): every step state from a fixture tour, every refusal string, composer validation, feed rendering (readable versus hidden matches the decoder).

Validation gate:
```
bun run lint && bun run typecheck
bun run --cwd apps/showcase test:components
bun run --cwd apps/showcase build:testnet
```
Pass: all seven steps render from the tour, and the refusals match `rules.ts`.

Layers: component.

**P12. Local e2e.**

Work:
- `e2e/agent.sh`, in order:
  1. ports;
  2. `net:up`;
  3. `bridge deploy local`;
  4. the heartbeat sidecar, for the claims the browser makes; it reads the manifest at startup (`sidecar.ts:97`), so it follows the deploy;
  5. `bridge demo setup local`, which runs its own heartbeat;
  6. build with the fixture tour and the bundle assertions (no smoke run: `try-happy` covers the same legs, within CI's 90 min);
  7. Playwright;
  8. reap.
- **Specs:**
  - `tour`;
  - `try-happy`: deposit → claim → pay → refund → withdraw, including the L1 payout;
  - `try-cheat`: pay a friend, cash out to B, a request for a user, and paying an unstamped request. Each is refused with its rule, and network capture shows no `sendTx`;
  - `resilience`: the duplicate-nullifier retry, a reload that resumes a pending withdrawal, the reset chip, and an empty float falling back to replay;
  - `crossOriginIsolated` is asserted.
- `_e2e.yml` runs it.

Validation gate:
```
bun run test:e2e && bun run lint:actions
```
Then push the branch and dispatch CI e2e on it: `gh workflow run _e2e.yml --ref galactica-compliant-usdc-showcase`, then `gh run watch`. `_e2e.yml` already carries `workflow_dispatch` on `main`, so the branch's own copy runs. `showcase.yml` can't be dispatched before merge.

Pass: green locally on a fresh network, and green in CI within 90 min.

Layers: browser e2e, local network.

**P13. Testnet live check.**

Work:
- `playwright.testnet.config.ts`: `baseURL` is `SHOWCASE_URL`. For this phase that's the hosted Workers preview URL of the showcase branch (Ask 8), so headers, CSP and isolation are tested as served. A local `vite preview` is only for development.
- `test:testnet` covers:
  - the tour and its identity;
  - live refusals by simulation;
  - one live L2 action (Galactica refunds Alice 0.01), proven in the browser if P10 said go and simulated otherwise;
  - a live Ethereum-lane deposit of 0.01 USDC from A_demo.
- Docs: the showcase sections of `architecture.md` and `operations.md`; A29.
- At the start of the phase, ask the owner for the Ask 8 change and wait for the preview URL. Push the branch so Workers Builds builds it.

Validation gate:
```
bun run --cwd apps/showcase build:testnet && SHOWCASE_URL=<preview URL> bun run --cwd apps/showcase test:testnet
```
Pass: green against the hosted preview on testnet, with no CSP violations in the console. The showcase is live on Workers before hardening starts.

Layers: live-testnet browser.

### Arc 6: hardening

**P14. `/harden security medium` on `contracts/`, EVM and Noir.**

Deliver the stakeholder report as an Artifact. The skill's `audit/` output is a vulnerability inventory, so it stays out of git (`audit/` goes in `.git/info/exclude`); the triage below is the committed record.

Validation gate:
```
test -s audit/security/<run-id>/report.md && test -s audit/security/<run-id>/findings/verified.md
```
Pass: the report's Artifact URL is recorded here, and every finding in `verified.md` is triaged, accepted or rejected with its reason, in `lessons/phase-14.md` and in this plan.

**P15. Fix the accepted findings.**

Each fix lands with a test, and a moved literal moves in all three toolchains in the same commit.

Validation gate, the contract checks of P1–P7 with the showcase in place of `apps/web`:
```
bash contracts/aztec/scripts/noir-deps.sh --self-test && bash contracts/aztec/scripts/noir-deps.sh && bash contracts/aztec/scripts/noir-deps.sh --verify
bash contracts/aztec/scripts/compile.sh --check && bun run test:noir
bash contracts/aztec/scripts/check-sole-consumer.sh --self-test && bash contracts/aztec/scripts/check-sole-consumer.sh
bun run test:evm && bun run test:evm:formal && bun run test:evm:gas
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com bun run test:evm:fork
bun run --cwd contracts/evm build && bun run lint && bun run typecheck && bun run test && bun run --cwd contracts/aztec test && bun run test:integration
RUN_ID=p15 bun run net:up && RUN_ID=p15 bun run bridge deploy local && RUN_ID=p15 bun run bridge verify local; s=$?; RUN_ID=p15 bun run net:down; test $s -eq 0
bun run --cwd apps/showcase test:components && bun run test:e2e
```

If deployed bytes changed, run the redeploy chain:
1. settle the old deployment's open tickets with the current CLI; record any left over with their `sourceCommit`;
2. the P9 keyed runs, by the keyed-run recipe;
3. `demo setup`, then `smoke --record`;
4. `verify --tour`;
5. commit the manifest, the demo tag and the tour;
6. `build:testnet`, `test:testnet` and `test:e2e`.

## Post-implementation

1. **Per-arc codex loop (arcs 1–6).** At each arc boundary, before `gh stack add` opens the next arc, run `/codex high` (GPT-6 Astra) with:
   - the arc's diff, this plan, the decision ledger and the arc map ("this is arc N of 6; later arcs build X on it");
   - the adversarial ask: "What could go wrong? What would an attacker target? What are we trusting that we shouldn't? Where are the supply-chain, crypto and least-privilege weaknesses?";
   - the two rules below, verbatim.

   Then:
   - verify each claim against the repo;
   - fix, commit, and log the round in `lessons/phase-N.md`;
   - resume the same session with the fix diff;
   - stop when a round yields nothing material;
   - still material after 3 rounds: stop and surface to the user.
2. **Final cross-arc pass.** A fresh codex session over the net diff from the plan baseline (`798682b`), asking for seams between arcs, duplication across arcs, and drift from this plan. Same loop.
3. **Delivery** (below): the first time any PR is opened.
4. **Close-out**, as the stack's docs-only top layer:
   1. an `## Outcome` block right after this front matter: date, status, PRs, what was dropped and why, and a line retiring the seeds;
   2. promote the generalizable gotchas into `implementations-plan/lessons.md`, keeping it under about 8 KiB: deduplicate, and retire what the new entries supersede;
   3. move the open follow-ups to `implementations-plan/follow-ups.md`: multisig tooling, delayed adds, a delayed admin handover (Ask 11), mainnet fee path, rollup upgrade, sponsor strategy, demo rotation;
   4. `git mv implementations-plan/galactica-compliant-usdc implementations-plan/archive/galactica-compliant-usdc` in its own commit, then repair the links;
   5. move the index line to `archive/index.md`.

   Then report and stop: merging is the user's call.

**No-over-engineering rule** (verbatim in every post-implementation codex prompt): *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."*

**Comment-quality rule** (verbatim in every post-implementation codex prompt): *"Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."*

## Delivery

| Arc | Branch | Phases | Stacks on | /code-review |
|---|---|---|---|---|
| 1 Merchant token | `worktree-galactica-compliant-usdc` | P1–P3 (plus the planning commits) | `main` | off |
| 2 Depositor-bound messages | `galactica-compliant-usdc-messages` | P4–P5 | arc 1 | off |
| 3 Bridge rules | `galactica-compliant-usdc-bridge-rules` | P6–P7 | arc 2 | off |
| 4 Operator and testnet | `galactica-compliant-usdc-operator` | P8–P9 | arc 3 | off |
| 5 Showcase | `galactica-compliant-usdc-showcase` | P10–P13 | arc 4 | off |
| 6 Hardening | `galactica-compliant-usdc-hardening` | P14–P15 | arc 5 | off |
| Close-out | `galactica-compliant-usdc-close-out` | docs only | arc 6 | off |

**During implementation**
- `gh stack init worktree-galactica-compliant-usdc` at the start. It adopts the existing branch; there is no `--adopt` flag.
- `gh stack add <next-branch>` at each arc boundary, after that arc's loop converges.
- Branches are pushed as checkpoints (`gh stack push`), and must be before every keyed run. Pushing opens no PR and runs no PR-gate CI.

**Delivery**, after every loop converges, and after the admin switch if P9 ran on the disposable fallback:
1. `gh stack sync` if `main` moved.
2. `gh stack submit --auto --open` (without `--open`, `--auto` creates drafts, which `gh stack merge` skips), then `gh pr edit` each body. Bodies end with "🤖 Generated with [Claude Code](https://claude.com/claude-code)".
3. Label the showcase and hardening PRs `e2e`, then `gh pr checks --watch`.
4. `gh stack add galactica-compliant-usdc-close-out`, the close-out commits, then `gh stack submit --auto --open`.

Merging (`gh stack merge --squash` on the close-out lands the whole stack) is the user's call. Workers Builds already points at `apps/showcase` (Ask 8), so production redeploys from `main` at merge. Then run `SHOWCASE_URL=<production URL> bun run --cwd apps/showcase test:testnet`.

## Decision ledger

Sources: **M** is the main draft, **C** is codex (GPT-6 Astra, high), **F** is the fable leg (Opus 5.5). "Agreed" means at least two drafts converged; "disputed" means the rejected side has a live argument that the audits should weigh.

| # | Decision | Source | Rejected alternative (source) and why | Status |
|---|---|---|---|---|
| 1 | Merchant list in the token; ABI superset | M, F | Separate registry behind `auth_contract` for strict ABI identity (C): an extra private call per restricted transfer, because a DPM is read by its owner | disputed (Ask 2) |
| 2 | Register `PublicImmutable<bool>` + off switch `DPM<bool, 3600>`; the register value is asserted | F (M: PublicImmutable) | Marker nullifier (C; raised again in the double audit by F): saves one ~4k-gate read per check, but hand-rolls the pre-check and existence request `PublicImmutable.read()` already does | agreed |
| 3 | `InitialDelay = 3600`; the setting applied at add; `set_merchant_delay` + admin-only `sync_merchant_delay` driven by the CLI | F (C: 3600 floor) | Batched on-chain delay proposals (C): heavy for a rare action. Build-time-only delay (M): a 1 h deployment would need a rebuild | agreed (see 24 for C's remaining point) |
| 4 | A cancel-only guardian, replaced on the delay, unset on testnet | C, F | No guardian (M): only the possibly compromised admin could cancel a malicious switch-off | agreed after the contradiction check (Ask 4) |
| 5 | `stamp(c)` + deterministic `pad(c)` in `merchant_stamp` | F (M: stamp + random pad) | `stamp(c, completer)` with no pad (C): the upstream validity commitment already binds the completer, and without a pad refund requests stand out | agreed |
| 6 | Hints choose the side in the token (the ABI can't change); explicit `bind` / `as_merchant` flags in the bridge | M, F (hints); C (flags) | Hints in the bridge (F): an oracle-side note lookup, harder to test in TXE; the bridge's ABI changes anyway | agreed after the contradiction check (F accepts the flags) |
| 7 | Merchants bind on private claims | C, F | A merchant claim branch (M): an extra cross-contract call in every merchant claim, and public deposits already serve multi-treasury merchants | agreed (Ask 3) |
| 8 | Two returns: private (derived secret) and public (raw secret, `!is_merchant(to)`) | F (M: two, without the guard) | One private return taking a raw secret (C): a copied public-claim secret could bounce a merchant's deposit | agreed |
| 9 | The pause also blocks returns | M, F | Returns open while paused (C): the explainer's pause "blocks every deposit and withdrawal", and a return is a withdrawal to Ethereum | agreed |
| 10 | `initialize(…, router)`; the router takes `token` explicitly | M, F | One-shot `setRouter` (C): an extra privileged call with an ordering hazard | agreed |
| 11 | Content formats `(amount, depositor)` / `(to, amount, depositor)` | M, F | `(depositor, amount)` ordering (C): no benefit; F's vectors were verified | agreed |
| 12 | Public deposits survive, claimable only by merchants | C, F, M | Dropping them (none) | agreed |
| 13 | Live Ethereum lane with a bounded public A_demo key and a replay fallback | C, F | Recorded-only lane (M): loses the live L1 story; the exposure is testnet assets | agreed |
| 14 | One PXE hosting four accounts | F | One PXE per actor (C, brief): 4× memory and sync | agreed; the user chose one PXE over the brief's one per actor (Ask 10) |
| 15 | `packages/demo`, shared by the deployer and the showcase; `signingKeyFor` in bridge-core | F (C: shared browser-safe module) | Cast inside the app (M): the deployer's smoke and funding need it too | agreed |
| 16 | Keyed runs split by role (deploy / admin / fund); separate generated admin key; keyless `smoke` via the demo cast | F, C (separate admin account) | One key for everything (M): no handover rehearsal, broader exposure | agreed |
| 17 | Keyless strict `verify`; `protocolVersion`; `consumed-unknown` | C, F | – | agreed |
| 18 | Proving harness with numeric thresholds in P10, not an early spike | F (C: its own infrastructure phase) | Early throwaway spike (M): contract design doesn't depend on it, and the UI supports both modes | agreed |
| 19 | CI e2e stays opt-in by label; delivery requires it green | F | Automatic e2e on relevant paths (C): about an hour of CI per push | agreed |
| 20 | Six arcs plus close-out, split by concern (token, messages, bridge, operator, showcase, hardening) | F | Nine arcs (C): more PR overhead. Five arcs (M): contract arcs too large to review in one sitting | agreed |
| 21 | Don't push planning commits to `main` | M | "Push the planning root to main first" (F, citing precedent): violates never pushing to main; merging is the user's call | agreed |
| 22 | Hardening after testnet goes live | brief (user) | Harden before deploy (none): the user fixed the order | agreed |
| 23 | `try_prove_merchant` returns `bool`, so the bridge refuses with its own rule text | F | An asserting view (M): the user would see the token's message instead of the exit rule | agreed |
| 24 | Delay increases apply at once (upstream's rule); the docs and ELI5 correct the explainer's "never instant" | M, F | An on-chain notice period for increases (C): an increase only slows switch-offs, and it's bounded at 86400 | resolved by the user 2026-09-30: apply at once (Ask 9) |
| 25 | The showcase goes live on a hosted Workers preview before hardening; production switches at merge | C | Local `vite preview` in P13 (M, F): not "live on Workers" before hardening, as the user ordered | agreed |
| 26 | A duplicate-nullifier failure reconciles the original submission before any retry | C | Blind retry once (F, M): could repeat a payment, burn or deposit that landed | agreed |
| 27 | CI e2e before merge by dispatching `_e2e.yml` on the branch | M | No pre-merge CI e2e (F): `_e2e.yml` carries `workflow_dispatch` on `main` | agreed |
| 28 | The merchant side reaches the token as a global-scope transient capsule, computed from the bulk-synced event feed under three rules (keep any eligible side; stamp a merchant recipient; else the longest horizon); generic wallets fall back to a counterparty-first probe | F (double audit), C (final pass: the rules) | Probing both parties on every call (consolidated plan): tells the node the prover's own address. An explicit side parameter: breaks the ABI superset | agreed |
| 29 | The constructors raise the guardian slot's delay to the setting | C, F (double audit) | – | agreed |
| 30 | Keyed runs execute from a dedicated worktree installed keylessly with `--ignore-scripts`; the scan runs in an EXIT trap; this session installs, builds, tests and commits nothing while a run is live | C, F (double audit), C (final pass: commits) | Installing inside the chain (consolidated plan): install scripts saw the secrets. No host work at all (F): editing is harmless, and other same-user processes stay a documented residual | agreed |
| 31 | Users' demo secrets take a random tag drawn and bound in `demo setup`, published only after both bindings finalize; merchants and L1 keys derive from the deployment | F (double audit), C (final pass: finality) | Fixed labels with a `v1`→`v2` rotation (consolidated plan): a griefer can pre-bind every future cast | agreed |
| 32 | `payments.ts` refuses a commitment it has paid or is paying, through a reserved → sent → paid record reconciled by tx hash; upstream's repeatable completion stays | C (double audit, final pass) | On-chain single-use requests: changes an upstream function's behaviour and adds a nullifier to every payment | agreed |
| 33 | Manifest `sourceCommit`, `bytecode_hash = "none"`, settle old tickets before a redeploy | C, F (double audit) | A git tag per deployment (F): a tag is a release action; the manifest carries the commit | agreed |
| 34 | Local e2e embeds a fixture tour; only testnet records one | F (double audit) | A recorded local smoke inside CI e2e (consolidated plan): a second full run inside the 90 min budget | agreed |
| 35 | `merchants delay` syncs every entry in the same tx | F (double audit) | One sync tx per merchant (consolidated plan): each merchant carries its own expiry for up to 23 h | agreed |
| 36 | P9 falls back to agent-generated disposable testnet keys when the owner is away, then switches the admin role to the owner's key | the user (approval gate) | Holding P9 until the owner approves (M, recommended): the owner preferred not to be a bottleneck, knowing a funded address and a written rule exception are still needed | decided by the user |

## Audit log (adopted vs rejected)

### Contradiction check (codex, resumed planning session; Opus planner, resumed)

**Adopted**
- **Local verify vs local demo merchants (C):** demo merchants are allowed on local and testnet; demo keys never hold an admin or minting role.
- **Blind duplicate-nullifier retry could repeat a landed action (C):** reconcile first; persist deposit secrets and submission records (ledger 26).
- **The acceptance run can't always `bind=true` (C):** `bind` comes from `get_funding_address`; the smoke asserts deltas and runs twice in P8; a poisoned demo binding means rotating the cast.
- **Gates masked failures behind `; net:down` (C):** now `s=$?; …; test $s -eq 0`.
- **Heartbeat started after the smoke that needs it (C):** it now starts before; local smoke owns a heartbeat.
- **Admin account never deployed or funded (C, F):** `admin accept` deploys it through the sponsor; P9 funds the sponsor first.
- **Showcase "live" only after merge, which is after hardening (C):** hosted preview before P14 (Ask 8, ledger 25).
- **Stamps outliving a switch-off were presented as settled (C):** acceptance is recorded, the headline narrowed, and the row-9 rationale fixed.
- **Ledger 16 misattributed (C):** fixed.
- **Local had no admin (F):** a fixed public local admin, with the handover in `deploy local`.
- **The /loop hard limit forbade the keyless demo steps (F):** carve-out added.
- **`gh stack init --adopt` and drafts from `--auto` (F):** `gh stack init <branch>` and `submit --auto --open`, checked against `gh stack --help`.
- **The Outcome over-claimed testnet coverage (F):** reworded.
- **Exit refusals without the rule text (F):** an unconstrained pre-check, with both branches asserting the rule.
- **Guardian (F, disputing ledger 4):** built, unset on testnet.
- **Where the L1 RPC comes from (F):** a committed public endpoint; the build refuses keyed variables; a bundle assertion.
- **Citations (F):** fixed; the expiry parity is cited, and labelled an inference pinned by A21; I6 no longer claims a measurement.
- **P9 order and gaps (F):** `secrets:scan` in every chain; funding before admin; L2 float seeding in `demo setup`.
- **Guard v2 mutants for the exit rules (F):** added.
- **Threat model (F):** added the 1 h liveness cost and gift revocation.

**Rejected**
- **An on-chain notice period for delay increases (C, high):** upstream applies increases at once by design (`scheduled_delay_change.nr:55-111`), and an increase can only slow switch-offs. The explainer's wording is corrected instead (ledger 24).
- **"CI e2e dispatch is impossible before merge" (F):** true for `showcase.yml` only. `_e2e.yml` is dispatchable from `main` and runs the branch's copy (ledger 27).

**Still disputed:** ledger 24 (C).

### Double audit (codex, resumed planning session: reject; fresh Opus: conditional approve)

**Adopted**
- **The guardian's delay started at 3600 s (C, F; high):** the constructors raise it, and `verify` and a TXE test check it (ledger 29).
- **Install scripts saw keyed secrets, and a failed command skipped the scan (C, F; high):** keyed worktree, keyless `--ignore-scripts` install, EXIT-trap scan, nothing installed, built or tested while a run is live (ledger 30).
- **The node learns who pays whom (F high, C medium):** the side capsule; the privacy ledger gains "your node"; `verify` and the page trust their endpoints, and operators pass their own (ledger 28).
- **A second payment into one request is lost (C, high):** `payments.ts` refuses reuse, and integration pins upstream's behaviour (ledger 32).
- **The pause was overstated (C):** "blocks new L2 claims, exits and returns", with what it can't reach listed; P7 tests a redemption during a pause.
- **Supply ≤ reserve isn't solvency (C):** called necessary, not sufficient; integration asserts the full liabilities equation.
- **`demo setup` had no heartbeat (C):** every local command that consumes a message owns one, and local setup funds A_demo and B_demo first.
- **Gates missed the EVM build, and P15 pointed at gates that name `apps/web` (C):** builds added; P15's command matrix is spelled out.
- **Recovery after a class-changing redeploy (C), and comment edits breaking `verify` (F):** `sourceCommit`, `bytecode_hash = "none"`, settle before redeploying; the mismatch error names the commit (ledger 33).
- **Settled-only is private completion only; authwit checks run before the rule (C):** both corrected.
- **Demo accounts have no confidentiality (C):** Ask 6 and the feed's label.
- **Predictable cast rotation lets a griefer pre-bind (F):** ledger 31.
- **Missing privacy entries (F):** stamp vs pad given `c`; the hidden side of a private↔public transfer; withdrawals to addresses that never deposited; batched delay syncs (ledger 35).
- **The supply-chain row overstated the release-age gate (F):** P1 drops the exclusions.
- **Citations (F):** fixed.
- **I10's CDP throttle (F):** a cgroup quota plus `hardwareConcurrency`.
- **Contract details (F):** "pending" means scheduled ≠ current; the hint prefers a merchant with no pending change; the binding note is delivered on-chain; three new guard mutants; the register value is asserted.
- **`packages/demo` never ran in CI (F):** `demo.yml` plus path filters.
- **Gates that didn't prove their claims (F):** P9 checks the push and the tour; keyless scans are described as the wallet-store check they are; the Outcome now matches what P13 proves.
- **Arcs 2 and 3 revert only as wholes (C, F):** stated in mechanics 11.
- **Scheduling (F):** the fixture tour in local e2e (ledger 34); P9's smoke runs from the keyed worktree.
- **Asks surfaced (F):** 9 (delay increases), 10 (one PXE), 11 (admin handover).

**Rejected**
- **Marker nullifier instead of the register (F, low):** it saves one ~4k-gate read per check, but hand-rolls what `PublicImmutable.read()` already does, and kernels dominate the proof (ledger 2, reason corrected).
- **Tagging the deployed commit (F):** a tag is a release action; the manifest records `sourceCommit` instead.
- **A test that recovers a prior deployment after a redeploy (C):** P15 settles old tickets first, and the mismatch error names the commit to use. A cross-version harness costs more than that residual.
- **"No other host work" during a keyed run (F):** narrowed to no installs, builds or tests by this session. Other same-user processes stay a documented residual, accepted for testnet keys.

**Still disputed:** ledger 24 (C), now Ask 9.

### Final pass (codex, fresh session): conditional approve

Verdict: "conditional approve (with conditions: close keyed-run execution gaps, repair validation gates, and specify hint, demo-tag, and payment recovery semantics)". Every condition was applied, without a re-review; the per-arc codex loops review the code.

**Adopted**
- **Commits during a keyed run execute the git hooks' third-party code (high):** the recipe now forbids commits while a run is live, and it is the one authoritative copy (ledger 30).
- **Three gates that couldn't pass:** P6 adapts the TS call sites to the new signatures; P8 resolves the hashed run directory through `bridge manifest-path`; P12 deploys before starting the sidecar.
- **Returns were listed as supply writes:** the privacy ledger now says what a return shows, and where.
- **The demo tag was published before the bindings were final:** `demo setup` waits for finalized claims (ledger 31).
- **The hint conflated eligibility, expiry and stamping:** three explicit rules, and every entry change now emits an event, so the SDK's feed is complete; a forged capsule is tested at the kernel (ledger 28).
- **The payment guard had no recovery lifecycle:** reserved → sent → paid, reconciled by tx hash, with reload and two-tab tests (ledger 32).
- **I12's gate proved PXE startup, not proving:** one real-proof tx from the keyed worktree (`BRIDGE_PROVE=1`).
- **Two residuals to state:** Galactica's own x402 client needs the same reuse guard, and batching beyond the call limit leaves cohorts.
- **The provenance header as a changelog:** it summarizes the delta; the diff against P1's verbatim copy is the record.

**Rejected**
- **A test that forces a real prune before the tag is published:** a unit test pins the finality barrier instead. Forcing a prune on demand isn't something the local harness does.
- **One copy of the review and delivery steps:** the seeds keep theirs, because a fresh session runs a seed before reading the whole plan. The keyed-run recipe, where the drift was, is now a single copy.

### Approval gate (the user, 2026-09-30)

Approved, with every Ask answered: 1–3, 5, 6 and 8 as recommended; 4 keep the guardian, unset on testnet; 7 yes, plus the disposable fallback (ledger 36); 9 apply delay increases at once; 10 one PXE; 11 keep the handover instant. Separately, the deploy and demo-funding runs were merged, since they use the same key, so the keyed path of P9 needs three approvals.

## Seeds (final, approved 2026-09-30)

ELI5 companion: https://claude.ai/artifact/LMk9CwqFzePvgSSaL6HAF6, published from `implementations-plan/galactica-compliant-usdc/eli5.html` (gitignored). Republishing that file keeps the URL.

Recommended: `/goal`
```
/goal All phases P1–P15 marked ✓ in implementations-plan/galactica-compliant-usdc/plan.md (the per-phase headers in the file — not the chat, not the task list), each ✓ backed by its phase's validation gate (as defined in plan.md) reported passing in the transcript; for each phase the agent has printed `LESSONS_FILE=implementations-plan/galactica-compliant-usdc/lessons/phase-N.md` in the transcript; plan.md's `code_review` is `off`, so `/code-review` was NOT run; the codex fix loop converged at each of the six arc boundaries and for the final cross-arc pass, each convergence evidenced by a resumed codex pass reporting no new material findings, quoted in the transcript; every command that needed keys in P9 (and P15 if contracts changed) exited 0, either as a keyed run the owner approved (`env-exec wait` output in the transcript) or through P9's disposable fallback, in which case the admin switch also completed (a `verify` run without the interim-admin warning, quoted); the Delivery section's seven-PR stack exists on GitHub, created only AFTER all loops converged (`gh stack view` output in the transcript), including the close-out that archived the plan (`git show --stat` of the archive-move commit in the transcript); `bun run test` and `bun run lint` both report exit 0 in the transcript.
```

Alternative: `/loop`
```
/loop 15m Drive implementations-plan/galactica-compliant-usdc forward. Never idle waiting for my input. Each firing:
1. **Reality check**: read implementations-plan/galactica-compliant-usdc/plan.md and lessons/ (authoritative state — not the chat), including its Outcome & Quality Bar section: every step is judged against those criteria, not just against "it runs". On a stack, read them from the TOP layer (`gh stack view` names it; `git show <top-branch>:<path>`), never from a lower arc's checkout. If that path is gone, the close-out has run: `git fetch -q origin && git cat-file -e origin/main:implementations-plan/archive/galactica-compliant-usdc/plan.md` succeeds → it merged and the plan is done: STOP and say so. Fails → delivered and awaiting my merge: babysit only (CI per step 2, fixes on the arc they belong to then `gh stack sync`, keep the Outcome true); once every PR is green, report that and STOP. A live plan.md that already carries an `## Outcome` block means a close-out was interrupted: finish it. Otherwise, native task list empty (fresh session)? rebuild it from plan.md, one task per remaining step; run `git status` and `git log --oneline -5`. If a PR exists, `gh pr view --json statusCheckRollup` (multi-arc: `gh stack view`). Without a PR, `gh run list --branch $(git branch --show-current) --limit 1 --json status,databaseId`.
2. **Waiting on CI or a keyed run is fine** — confirm it's progressing (`gh run watch <run-id>` up to 10 minutes; `env-exec status <id>`). A step that needs a keyed run: follow plan.md's keyed-run recipe exactly (it prints the `op-remote <host> <id>` line for me); while the run is live, only edit files: no installs, builds, tests or commits.
3. **No task in hand?** Pick the next pending step from plan.md and start it. After each meaningful edit, run `bun run lint` + the touched packages' tests. Then commit → push (`gh stack push`; `gh stack sync` if main or a lower arc moved).
4. **Stuck, or facing a decision you'd normally bring to me?** Call `/codex high` with full context until you reach a defensible decision, then act on it. Log every consult + verdict in lessons/phase-N.md. Hard limits stay hard: never merge, never push to main, never publish or deploy outside the approved keyed runs — except the keyless demo-cast actions plan.md runs with the public demo keys (P9 step 4, P13) and P9's disposable fallback exactly as plan.md defines it — never create or handle secrets outside keyed runs and that fallback, never expand scope beyond plan.md; if a decision requires crossing one, surface it and hold.
5. **Same step failed 5 times?** Stop retrying; reassess with codex, then continue down the agreed path.
6. **Phase green?** "Green" means the phase's validation gate as written in plan.md passes. Run the full gate, paste the result, mark ✓ in plan.md, file the lessons entry, print `LESSONS_FILE=implementations-plan/galactica-compliant-usdc/lessons/phase-N.md`, advance. Arc boundary crossed (per the Delivery table)? Run the arc's codex loop FIRST (`code_review` is off: no /code-review) with the arc map and the plan's no-over-engineering + comment-quality rules until a round yields nothing material — THEN `gh stack add <next-arc-branch>`.
7. **All phases ✓?** Run the final cross-arc pass (fresh codex, net diff from 798682b, seams / duplication / plan drift, same rules, loop until clean). Then Delivery per plan.md — the FIRST time any PR is opened: `gh stack sync`, `gh stack submit --auto --open`, `gh pr edit` bodies, `e2e` labels; then the close-out layer (`gh stack add galactica-compliant-usdc-close-out`, its commits, `gh stack submit --auto --open`), then `gh pr checks --watch`. Then write the wrap-up: what shipped, every contentious decision codex and I debated — each with ELI5 context (the question, the options, why we picked ours) — and open items. Surface and stop — merging is my call.

Keep the native task list current (`TaskUpdate` as steps start/finish; plan.md stays the source of truth).
```

Use exactly one per session: they don't compose. Start the session in the permission mode you intend. The keyed runs in P9 and P15 wait for your `op-remote` approval by design.
