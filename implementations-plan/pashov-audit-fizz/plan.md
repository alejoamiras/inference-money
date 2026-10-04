---
plan: pashov-audit-fizz
tier: deep
status: approved 2026-10-04
base: 6fd8f98
driver: claude-code
claude_model: fable
code_review: off
eli5_mode: artifact
budget: recon 3 agents; code-review off; Codex at high
---

# Fix the open audit findings (Pashov solidity + Aztec.nr lenses, fizz)

**Sources.** On 2026-10-02 these ran over `9f84cdb`:
- the Pashov solidity-auditor;
- its Aztec.nr adaptation;
- the fizz Medusa campaign;
- the fizz-lens Noir property map.

On 2026-10-04 everything was re-validated at main `6fd8f98`, after #18, #19, #22 and #23:
- **Already fixed or bounded by main:** zero-amount completion, unlimited stamped payments, the completion squat, the unlogged admin swaps, and the blacklisted funding address.
- **Still open:** every other finding and lead. This plan fixes or documents each one.
- **Codebase map:** `recon.md`.

Decisions are in **Decision ledger**, at the end.

## Outcome & Quality Bar

**For whom.**
- **Users depositing USDC.** The Ethereum address their Aztec account binds to is its exit address for good. It must always be an address whose key holder consented to that exact deposit.
- **Merchants.** They bind their own treasury before they are listed. They still withdraw after a switch-off. Two merchants paying each other leak nothing through a tx's expiry.
- **Integrators building a periphery** (swap-and-deposit, batchers, smart accounts). They get one documented, signed portal entry point whose EIP-712 vectors are pinned in Solidity and TypeScript.
- **The operator.** They get a committed, nightly fuzz suite and a runbook that lists merchants only after they bind.

**What excellent looks like.**
1. **Only a key holder can be named on L1.** No `mint_to_private(amount, depositor)` message is produced unless `depositor`'s key signed either the router's Permit2 digest for that deposit, or the portal's `FundingAuthorization` for exactly (submitter, amount, secretHash, deadline). Every rule that enforces this has a test that fails when the rule is deleted: a halmos proof where the rule is reachable before `sha256`, and a forge mutant canary otherwise.
2. **The hint proves the right side.** Of two merchants it proves the one whose read keeps the later expiry horizon, using aztec-nr's own arithmetic. The two public-side transfers prove the side the call already publishes. TXE and the bridge-core mirror pin the same literal cases.
3. **Refusals are typed and actionable.** `claim()` refuses to bind without `allowBind`, and the showcase asks first. A private router deposit that a contract signed fails client-side with `KeyHolderRequiredError`, after signing and before gas estimation or broadcast. Each typed error is listed in `docs/integration.md` with what to do next.
4. **Every check passes before the redeploy.** The fizz suite runs nightly from pinned tools and fails the job on any broken property. The re-audits leave no open finding. The redeployed testnet passes `bridge verify --tour`, `test:evm:fork` and `test:testnet`.

**Good enough stops at:**
- no defence against a dishonest Aztec node;
- no ERC-1271 funding addresses;
- no SDK flow for the portal's signed path: a pinned typed-data builder and docs only;
- no L1 rescue for deposits stranded by a rollup upgrade (the guard closes the window after the switch, and the window before it stays a named residual);
- no fix for the named residuals: a published key, a 7702 delegation to an open executor, a custodial intermediary.

## Architecture & Implementation

### 1. L1: who a deposit names

**The private depositor is the funding identity:**
- On L2 it becomes a user account's binding for good (`token_bridge/src/main.nr:177-183`).
- It is that account's only exit destination (:258-266).
- It is the payee of a return (:208).

**The invariant:** the private depositor is a key holder who signed this exact deposit. The public depositor is only a refund address. `claim_public` hashes it (:145), `return_deposit_public` pays it (:221), and no exit reads it (:224-270).

The signature proves consent to the deposit and to the funding identity. It does not prove the USDC's provenance. The tokens always come from the portal's caller (`_pullExact`, `TokenPortal.sol:273-277`), which may be a periphery.

#### 1a. Router (the SDK path; `deposit` ABI unchanged)

For a private deposit, the router re-derives the Permit2 digest and requires `ECDSA.recoverCalldata(digest, signature) == msg.sender`. This runs before Permit2 is called, and Permit2's own check (owner = `msg.sender`) stays. The two checks are a conjunction: whichever branch Permit2 takes, the caller's key signed the identical digest.

```
structHash = keccak256(abi.encode(
  PERMIT_WITNESS_TYPEHASH,                    // keccak256(STUB ‖ DEPOSIT_WITNESS_TYPE_STRING)
  keccak256(abi.encode(TOKEN_PERMISSIONS_TYPEHASH, TOKEN, amount)),
  address(this), nonce, deadline,
  hashWitness(aztecRecipient, secretHash, isPrivate)))
digest = MessageHashUtils.toTypedDataHash(PERMIT2.DOMAIN_SEPARATOR(), structHash)
```

Here `STUB = "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,"`. This is `test/mocks/Permit2Digest.sol:29-34` lifted into `src/`. `DOMAIN_SEPARATOR()` is read live rather than cached in an immutable, so it stays correct across chain-id changes and costs about 2.7k gas.

The digest derivation mostly fails closed: a wrong digest recovers some address other than the caller, so most derivation bugs refuse every honest deposit (a loud DoS).

The exception is a bug that leaves out a field. Then an old signature still verifies after that field changes, and for a 7702 owner with a permissive 1271 delegate, Permit2 adds no independent protection. So the router tests also keep the original signature and tamper with each field (amount, recipient, secretHash, privacy, nonce, deadline), and require a refusal. The pinned literals and the fork test cover the derivation itself.

| Account | Result |
|---|---|
| Plain EOA | Passes, one signature, one tx (unchanged) |
| EIP-7702 account whose delegate implements ERC-1271 honestly | Passes: Permit2 calls `isValidSignature`, and the router independently recovers the key |
| 7702 account whose delegate lacks ERC-1271 | Refused by Permit2 before anything moves. It uses the portal's signed path through an integrator |
| 7702 account with a permissive 1271 delegate | Passes only if the key really signed. Its residual is the named "delegated to everyone" one |
| ERC-1271 contract (Safe), honest or permissive (audit F-02) | Refused, because no key recovers to a contract address. A 65-byte signature gets `SignerIsNotTheCaller`; an empty or other-length one gets OZ's `ECDSAInvalidSignatureLength(n)`. A Safe deposits through the portal path, with an owner EOA as depositor |
| Constructor-time caller | Refused: nothing recovers to its address |
| ERC-2098 64-byte or high-s signature | Refused with OZ's typed error before Permit2. Permit2 alone would accept both. viem signs 65 bytes, low-s |

Public deposits are unchanged and keep Permit2's own check. Their depositor is only a refund address, so a Safe may still deposit publicly.

#### 1b. Portal: signed private deposit and explicit public refund address

```solidity
contract TokenPortal is ITokenPortal, ReentrancyGuardTransient, EIP712 {
    // EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)
    constructor() EIP712("InferenceMoneyTokenPortal", "1") { initializer = msg.sender; }

    bytes32 public constant FUNDING_AUTHORIZATION_TYPEHASH =
        keccak256("FundingAuthorization(address depositor,address submitter,uint256 amount,bytes32 secretHash,uint256 deadline)");
    mapping(bytes32 digest => bool) public authorizationUsed;

    error ZeroAmount();
    error RollupNotCanonical();
    error InvalidDepositor();                 // a public refund address of zero, this portal or the router
    error AuthorizationExpired(uint256 deadline);
    error AuthorizationUsed();
    error SignerIsNotTheDepositor();

    function depositToAztecPublic(address _depositor, bytes32 _to, uint256 _amount, bytes32 _secretHash)
        external nonReentrant returns (bytes32, uint256);
    function depositToAztecPrivate(
        address _depositor, uint256 _amount, bytes32 _secretHashForL2MessageConsumption,
        uint256 _deadline, bytes calldata _signature
    ) external nonReentrant returns (bytes32, uint256);
    function fundingAuthorizationDigest(
        address _depositor, address _submitter, uint256 _amount, bytes32 _secretHash, uint256 _deadline
    ) public view returns (bytes32);          // _hashTypedDataV4(structHash)
    // unchanged: depositToAztec{Public,Private}For (router-only), withdraw, initialize; eip712Domain() from OZ
}
```

**The signed private entry point, in order:**
1. `_requireUnexpired(_deadline)`;
2. `digest = fundingAuthorizationDigest(_depositor, _submitter(), ...)`, where `_submitter()` returns `msg.sender` and is a hook only so the canary can replace it;
3. `_consumeAuthorization(digest)`, which checks and sets the used bit;
4. `_requireSigner(_depositor, digest, _signature)`;
5. `_depositPrivate(_depositor, ...)`, which checks non-zero, the u128 cap and the canonical rollup, then hashes, pulls from `msg.sender` and sends.

Any later revert rolls the used bit back.

- **The depositor is signed, explicit, and recovered == `_depositor`.** All three are needed:
  - Recovery alone would turn a malformed signature into a random, keyless depositor. The claim would bind to it and the user's exits would be stranded.
  - The comparison alone is forgeable. If the digest left the depositor out, anyone could pick a signature, recover its address from the known digest, and name that keyless address. Codex reproduced this with `r = s = 1, v = 27`.
  - Signing the depositor makes the digest depend on the address it must recover to, which needs the key.

  `recoverCalldata` reverts on an `address(0)` result.
- **The submitter is bound by hashing `msg.sender` into the struct (owner decision).** Someone else submitting the same signature produces a different digest and is refused. So a mempool watcher cannot submit the authorization first with its own USDC, which would credit the depositor's account with money it never sent, under its name. A periphery always knows its own address. For a 4337 account, the submitter is the smart account, as the immediate caller.
- **Exactly once.** The used bit is keyed by digest; `secretHash` is in the struct, so honest authorizations never collide. A nonce bitmap (for cancellation) was not taken: the deadline bounds the window.
- **The domain binds chainId and the portal,** so there is no cross-chain or cross-portal replay. OZ rebuilds the separator on a chain-id change.
- **On a reorg,** the used bit and the Inbox message reorg together. The SDK's finalized-hash reconcile is unchanged.
- **Public deposits.** `_requireDepositor` refuses three refund addresses:
  - zero;
  - the portal: a withdraw to the portal never debits it, so it always reverts (`TokenPortal.sol:203-207`);
  - the router: it is ownerless, and `_checkSettled` pins its balance, so a refund there could never leave. The check sits in `_depositPublic`, so it also covers the router's routed public leg.
- **Every deposit path** gets `_requireNonZero` and `_requireCanonical` before the pull. `_requireCanonical` is `address(registry.getCanonicalRollup()) == address(rollup)`. `withdraw` is untouched: it consumes the pinned outbox, so every proven exit still pays after an Aztec governance upgrade.
- **The aztec.js helpers.** Both direct selectors change, so aztec.js's stock `bridgeTokens{Public,Private}` now revert before any transfer. Previously they lost the secret, or sent a message no call could consume (the two Solidity leads).
- **Guard order.**
  - `_depositPublic`: `_requireNonZero` → `_requireDeposit` (cap) → `_requireRecipient` → `_requireDepositor` → `_requireCanonical` → hash → pull → send.
  - `_depositPrivate`: the same, without the two recipient and depositor guards.

  Every proof assumes valid values for the guards it does not target, so it fails only on its own rule.
- **Hooks for the canaries.** Every rule is its own `internal virtual` hook, so each canary deletes exactly one rule and the existing mutants stay valid:
  - `_requireNonZero`
  - `_requireCanonical`
  - `_requireDepositor`
  - `_requireUnexpired`
  - `_consumeAuthorization`
  - `_requireSigner`
  - `_submitter()`, which returns `msg.sender`
  - `_fundingStructHash(depositor, submitter, amount, secretHash, deadline)`, which `fundingAuthorizationDigest` wraps with `_hashTypedDataV4`. The `PortalUnsignedDepositor` mutant overrides it to drop the depositor.
- **Unchanged:** the events and `ITokenPortal`.
- **The header comment** (`TokenPortal.sol:1-14`) loses "a direct deposit names `msg.sender`" and gains the signed private deposit, the explicit public refund address, and the two guards.

**Router additions.**
- Constants:
  - `TOKEN_PERMISSIONS_TYPEHASH`
  - `PERMIT_WITNESS_TYPEHASH`
- `permitDigest(amount, aztecRecipient, secretHash, isPrivate, nonce, deadline) public view`.
- `error SignerIsNotTheCaller()`.
- `_requireSigner(...) internal view virtual`, called only when `isPrivate`.
- `_checkIntent` is untouched, so the four intent mutants stay valid.
- Natspec (:11-13): "a private depositor is the key holder of the caller".

#### 1c. Residuals no contract can close (named in `docs/architecture.md`)

- A published key.
- A 7702 delegation to an open executor: anyone moves the depositor's L1 funds, but the L2 binding is still to that address.
- A custodial intermediary that signs for many customers.
- An open periphery: if the named submitter lets strangers trigger the authorized deposit, that is the periphery's bug.
- The signature binds the L1 depositor, not the L2 account. `claim_private` binds whichever account holds the claim salt. A depositor that lets the submitter derive the salt becomes the exit address of an account it does not control: it is then acting as a custodian. The docs say the depositor derives its own salt (`prepareDeposit`).
- An unsigned public refund address is a pay-to-taint vector. Anyone can deposit 1 unit publicly to a non-merchant account naming a victim V as the refund address. `return_deposit_public` is callable by anyone, so the unit lands on V. No funds are at risk; it is named in `docs/architecture.md`.
- The demo's public L1 keys can be 7702-delegated by anyone, which would break their router deposits. Follow-up: `probe` reads their code.
- A rollup upgrade strands any deposit not yet consumed before the switch (`follow-ups.md`).

### 2. Aztec: hint privacy (F-1, F-2, F-4, F-5)

**`Entry { merchant: bool, horizon: u64 }`** replaces `pending`, whose only readers are `hints.nr:48,52`. `probe` decodes the delay change from the field it already reads, so there is no extra oracle call:

```
svc = unpack_value_change::<bool,1>(raw)                     // existing
sdc = unpack_delay_change::<MERCHANT_MIN_DELAY>(raw[0])      // new; INITIAL_DELAY must equal the storage's 3600
d   = sdc.get_effective_minimum_delay_at(now)                // post−1 once applied, else min(pre, tsc−now+post)−1
horizon = svc.get_time_horizon(now, d)                       // now+d once applied, else min(now+d, tsc−1)
```

This is exactly the cap `_assert_merchant`'s read sets. The two horizon functions are in the pinned protocol crate (`scheduled_delay_change.nr:128`, `scheduled_value_change.nr:64`). Find the place aztec-nr applies the cap by reading the source before the `hints.nr` comment cites it. `MERCHANT_MIN_DELAY`/`MERCHANT_MAX_DELAY` move from `main.nr:52-53` to `hints.nr`, and `main.nr` imports them. If a spike shows the `#[storage]` generic refuses an imported global, the fallback is a duplicated literal pinned by a TXE equality test.

**`merchant_side_hint(list, first, second, keep_first)`:**
1. A capsule wins, as today.
2. `a = probe(first)`. If `a.merchant` and (`keep_first`, or `a.horizon == now + MERCHANT_MAX_DELAY − 1`, the maximum), return FIRST without probing `second`.
3. `b = probe(second)`. If `b.merchant` and (`!a.merchant` or `b.horizon > a.horizon`), return SECOND.
4. Return FIRST if `a.merchant`, else NEITHER.

**Equal horizons pick FIRST,** which keeps `between_two_settled_merchants_the_probe_proves_the_recipient` and the stamp convention.

**Call sites.**
- `transfer_private_to_public` (`main.nr:241`) becomes `(to, from, true)`: `to` is published.
- `transfer_public_to_private` (:358) becomes `(from, to, true)`: `from` is published. Its side never feeds `_push_request_stamp`, which reads FIRST as "recipient proven".
- :267, :297 and :375 are unchanged.

**Rename `opening` → `keep_first`** in:
- `main.nr:1105-1111`;
- `hints.nr:6-9,38-39,44`:
  - rule 2 becomes "the side a call already publishes, or a request's merchant recipient, is always proven";
  - rule 3 becomes "of two merchants, the one whose read keeps the later horizon";
  - the header adds one sentence: with no capsule, the probe now queries the second account unless the first already has the maximum horizon, a node query traded for the on-chain gain. `docs/integration.md`'s "Your node" bullet says the same;
- `B/merchants.ts:124-135` and `B/payments.ts:196,217`;
- the test helper `side()`.

**Comment fix.** The `MERCHANT_MAX_DELAY` comment (`main.nr:50-51`) wrongly attributes 86399 to `MAX_TX_LIFETIME`. 86399 is `anchor + delay − 1` under the class-update horizon; `MAX_TX_LIFETIME` is 86400.

**No new external function, storage or event,** so the `abi-superset.test.ts` lists stay as they are. `token_bridge/src/main.nr` is untouched (it is text-pinned).

**The bridge-core mirror** (`B/merchants.ts`):
- `MerchantEntry` gains `delay`, `scheduledDelay` and `delayChangeAt`, from the `sdc` that `syncMerchantList` already reads and drops (:107).
- New exports: `effectiveMinimumDelayAt(e, at)`, `timeHorizon(e, at, d)` and `merchantHorizon(list, account, at)`, which is 0n for an unlisted account.
- `merchantSide(list, first, second, keepFirst)` compares horizons.
- `merchantStatus` keeps `{merchant, pending}`; `admin.ts:136` and the strict `toEqual`s read it.

The SDK always sends a side capsule (`payments.ts:196-220`), so the mirror is the hint that SDK users actually run. TXE (`token/src/test/hints.nr`) and `B/merchants.test.ts` therefore assert the same literal horizons for the same cases:
- a settled 24 h entry;
- a 1 h entry;
- a pending switch-off;
- a pending delay decrease two hours in;
- the transition −1, at the transition, and +1;
- unset delay (3600).

### 3. Aztec: the stamp-constraint tripwire (owner decision)

A new script, `contracts/aztec/scripts/check-stamp-constraint.sh [--self-test]`, in the style of `check-sole-consumer.sh` (strip comments, flatten, extract the function body).

**What it requires.** It reuses `check-sole-consumer.sh`'s control-flow and depth checks (`flow_is`, :99, :138). Presence alone is not enough: an `if false { … }` wrapper would keep the text and remove the constraint. The script requires the exact assignments `let stamp_nullifier = stamp(commitment, bucket)` and `let deadline = stamp_deadline(bucket)`, and these, at the FIRST branch's own depth with no nested branch around them. Inside `_prove_payment_side`'s `if side == FIRST {` block, in this order:
- `stamp(commitment, bucket)`;
- `stamp_deadline(bucket)`;
- `self.context.assert_nullifier_exists(NullifierExistenceRequest::for_settled(compute_siloed_nullifier(self.context.this_address(), stamp_nullifier)))`;
- `self.context.set_expiration_timestamp(deadline)`.

It also refuses three more things:
- any rebinding of `stamp_nullifier`, `deadline` or `bucket`;
- an `unconstrained` qualifier on `fn _prove_payment_side`;
- a paying function without `let side = self.internal._prove_payment_side(from, commitment);` (`main.nr:324`).

**The `--self-test`** runs six text mutants and requires each to fail for its own reason:
- wrap the assert in a dead branch (`if false { … }`);
- delete the assert;
- delete the expiry;
- move the assert outside the branch;
- rebind `stamp_nullifier`;
- swap `for_settled`.

It runs in `_contracts.yml`'s Noir job after the sole-consumer guard.

**Alternative not taken:** a mutant Token artifact in an integration spec. It is about 1-2 days of new build and deploy harness for a kernel guarantee aztec-nr provides.

### 4. SDK: bind consent and the signer pre-check

**`claim` and `waitClaimable`** both take `allowBind?: boolean`.
- `claim` and `waitClaimable` each evaluate `claimBinding` and the consent once, up front, before `waitConsumable`'s polling loop. The `claimCall` check stays as the backstop. Either throws `BindConsentRequiredError(recipient, depositor)` when the answer is "binds" and `allowBind !== true`. The error surfaces at once, not after L1→L2 inclusion, and before any simulation or send.
- The error propagates unchanged, never as a polling timeout.
- A bound account never needs consent.
- `castClaim(s, t, onWait?, opts?: { allowBind?: boolean })` forwards consent and does not default it. Only `demo setup` passes `allowBind: true`, for its intended bindings. `smoke` claims for an already-bound alice, which must answer "matches": consent there would hide a rotated or poisoned binding.

**The showcase asks first.** Before claiming it checks `claimBinding`. On "binds" it asks through `LiveCtx.confirm` (default `window.confirm`), showing both full addresses. A decline sends nothing, keeps the ticket, and shows "Nothing claimed: the binding was declined". An accept passes `allowBind`. The copy goes by role:
- **If it's a user:** "Claiming this deposit binds this account, for good, to 0x… (the address it came from). Later private deposits must come from there, and withdrawals go only there. Claim and bind?"
- **If it's a merchant:** "Claiming binds this merchant account, for good, to 0x…. While listed you may withdraw anywhere; after a switch-off, only there. Bind your own treasury, never a customer's."

**Signer pre-check** (`B/deposit.ts` `signAndSend`). For a private deposit, the signature must pass the same rules the router applies, else `signAndSend` throws `KeyHolderRequiredError(account)` ("the wallet signed as a contract; private deposits need the key holder's own signature, or use the portal's signed path"):
- 65 bytes;
- `v` is 27 or 28 (viem accepts `00`/`01`; OZ refuses them);
- low-s (viem's recovery accepts high-s, OZ does not);
- `recoverTypedDataAddress(typedData, signature)` equals the account.

Recovery errors (`recoverPublicKey` throws on a malformed length) are caught and translated to the same error. This runs after signing and before deposit gas estimation or broadcast. A Permit2 approval made earlier is not undone. Tests: a malformed length, high-s, `v` = 0/1, and a valid signature from another key.

**`B/funding-authorization.ts`** (new, exported) provides:
- `FUNDING_AUTHORIZATION_TYPE`
- `FUNDING_AUTHORIZATION_TYPEHASH`
- `fundingAuthorizationTypedData({ depositor, submitter, amount, secretHash, deadline }, portal, chainId)`

It is pinned to the Solidity literals. There is no SDK deposit flow on it.

**`B/abi.ts`** additions:
- **Router:** `SignerIsNotTheCaller` and OZ's `ECDSAInvalidSignature`, `ECDSAInvalidSignatureLength(uint256)` and `ECDSAInvalidSignatureS(bytes32)`.
- **Permit2:** a two-entry error list, `InvalidContractSignature()` and `InvalidSigner()`. These decode only where Permit2 raises them, that is, when a delegate returns the wrong magic value. A delegate with no `isValidSignature`, or one that reverts or returns short data, fails with another revert, often empty. `docs/integration.md` says so and names the next step: the portal path.
- **Portal:**
  - the two new direct deposits and both `...For`;
  - both deposit events;
  - `fundingAuthorizationDigest`, `authorizationUsed`, `eip712Domain`;
  - every new error, plus the three ECDSA errors.

`PERMIT2_DEPOSIT_ROUTER_ABI[0]` stays `deposit` (`abi.test.ts:49-53`).

### 5. Onboarding: bind before listing (F-03 by design, owner decision)

`claim_private` keeps letting an unbound account bind, so a switched-off merchant with no binding can still withdraw somewhere.

**The docs say:**
- a switch-off demotes a merchant to a user; it does not freeze it;
- the stolen-key race: claims pause during the emergency, so after the unpause the thief and the owner race to bind;
- onboarding lists a merchant only after it binds its own treasury with one 1-unit private deposit;
- the cost: a bound merchant takes only its own private deposits, and customers pay it publicly or by L2 payment.

**Demo flow.**
- `packages/deployer/src/demo.ts`: `SEEDS` gains `galacticaBind` and `supplierBind`. Each is a 1-unit private router deposit from that merchant's cast L1 account (`castMember(m, merchant).ethereum`), claimed with `allowBind: true`.
- **Bind first, verify, then list.** Before listing, or before printing the testnet listing instruction, both merchant bind claims are kept until final (`keepUntilFinal`). Then each merchant's funding note is read back through the demo wallet (`fundingAddress`, `B/binding.ts:12`), and must equal its treasury. A mismatched binding refuses onboarding, with a message naming the recovery: redeploy, or list a different merchant account. The cast's keys are public, so anyone can poison a demo merchant's binding before `demo setup`. This is an accepted demo residual (see Asks); no rotation machinery is added.
- `keepUntilFinal`'s re-claim after a prune (`claim-finality.ts:15-38` → `demo.ts:131-133`) forwards `{ allowBind: true }` for the bind seeds. A pruned first claim loses its binding too, so without consent the re-claim would retry forever. `castClaim`'s `"already"` covers a returned message too, and finality checks consumption, not the binding, so this read-back is the proof.
- `ensureMerchantsListed` moves out of `prepare` to after the bind seeds are verified, and before the user seeds. Galactica's public float needs it listed.
- **Local:** it lists the merchants itself.
- **Testnet:** it stops with the existing "List the demo merchants first" message, and the resumable `SetupPlan` carries the tickets across the keyed `merchants add`.
- `demo fund` also funds the two merchant L1 accounts with gas and 1 unit. `castDeposit` already approves Permit2. This widens three things from `User` to `Actor`:
  - `demoL1(rpcUrl, m, user)` and `DepositPlan.from` (`packages/demo/src/flows.ts:66,115`);
  - `fundDemoL1` and `DEMO_L1_TARGET` (`packages/deployer/src/demo-l1.ts:41-44`).

**`merchants add`** prints a one-line reminder. The binding is a private note only its owner reads (`token_bridge/src/main.nr:124-127`), so the CLI cannot check it.

**Runbook** (`docs/operations.md:51`):
1. keyed: deploy + `demo fund`;
2. keyed: `admin accept`;
3. keyless: `demo setup` (binds, then stops);
4. keyed: `merchants add`;
5. keyless: `demo setup` again, then `smoke --record`.

### 6. Fizz and the nightly job

**Arc 1 commits the suite as it is:**
- `contracts/evm/test/fizz/`, `medusa.json` and the `[profile.fuzz]` block;
- `contracts/evm/PROPERTIES.md`, with the absolute path at :31 stripped;
- the `fizz_data` inputs and report: `report.md`, `property-plan.md`, `coverage-targets.md`, `invariant-context.md`, `cost-estimate.md`, `contracts.json`, `entry-point-selection.json`;
- `contracts/aztec/PROPERTIES.md`.

**Root `.gitignore` additions:**
- `contracts/evm/fizz_data/{corpus_medusa,logs_medusa,crytic-export}/`
- `contracts/evm/fizz_data/last-run.json`
- `contracts/evm/x-ray/`
- `.solidity-auditor/`
- `.aztec-auditor/`

`echidna.yaml` is deleted: only Medusa runs.

**GL-26.** The actor-side mock supply is bounded to `type(uint128).max` in total (USDC is about `2^57`), covering every top-up and max handler; the max-amount handlers deposit what is left, so the per-call u128 cap's edge stays reachable (a `2^64` bound would have cut it off). The cumulative-u128 case is documented as unreachable with real USDC.

**Arc 2 adapts the suite to the new ABIs:**
- Actors become key-held EOAs: `vm.addr(pk)` + `vm.deal`. Contract `Actor`s remain only as refused callers.
- Router legs sign `router.permitDigest(...)`. Portal legs sign `portal.fundingAuthorizationDigest(depositor, submitter, ...)` with the depositor's key, and are submitted by another actor.
- `MockPermit2.DOMAIN_SEPARATOR()` returns the real formula; it is `bytes32(0)` today.
- **Flipped:**
  - SP-22: zero reverts on every path with no state change;
  - SP-21: a routed deposit against a signed direct one by the same signer.
- **GL-19** stays (router-only `...For`).
- **New properties:**
  - every private message's depositor is the key that signed;
  - no deposit lands while the canonical rollup is not the portal's, while withdraws still pay;
  - a reused or foreign-submitter authorization is refused;
  - a foreign signature reaches neither Permit2 nor the Inbox;
  - a public refund address of zero or the portal is refused.

**Nightly workflow:** `.github/workflows/fuzz-contracts.yml`.
- **Triggers:** `schedule` + `workflow_dispatch`.
- **Permissions:** `contents: read`, no secrets, SHA-pinned actions.
- **Concurrency:** `fuzz-contracts`.
- **Timeout:** `timeout-minutes: 90`.
- **Tools.** `setup-toolchains` gains a `medusa` input:
  - the Medusa 1.5.1 linux-x64 release tarball, checked against a committed `setup-toolchains/medusa-1.5.1.sha256`;
  - crytic-compile from the existing Slither hash lock, which pins `crytic-compile==0.4.2` at :536.
  - `toolchain.json` gains `medusa` and `cryticCompile`.
  - Both tools must be ≥ 7 days past release when pinned.
- **Run.** `bun run --cwd contracts/evm test:evm:fuzz`, which:
  - sets `FOUNDRY_PROFILE=fuzz` for the Medusa process only (an ambient leak changes bytecode and fails `verify`);
  - runs `medusa fuzz --timeout 3600 --test-limit 0` (`medusa.json`'s `testLimit: 500000` would otherwise end the campaign in minutes), and records the elapsed runtime;
  - fails on a nonzero exit (Medusa exits 7 on any failed test, S1; a `test_results` scan would also trip on a locally restored corpus's old reproducers). `"stopOnNoTests": true` covers only an empty combined test list: assertion testing is on, so it does not prove the properties were found. The script therefore checks that Medusa's log lists every public `property_*` function.
  - "Signed private deposits actually ran" is checked at the local P5 gate, from Medusa's coverage report on the signed handlers. CI has no counter for it.
- **Corpus.** Cached by `actions/cache`, keyed on hashes of `test/fizz/**`, `src/**` and `medusa.json`, with a `restore-keys` prefix so a source change replays the old corpus instead of starting from zero.
- **On failure.** Uploads the logs and reproducers with finite retention.
- **Ownership.** `medusa.json` stays for local runs. CI passes `--timeout`, so there is no runner script and no plateau regex.

### 7. File-level change map

| Area | Files |
|---|---|
| L1 src | `contracts/evm/src/{TokenPortal,Permit2DepositRouter}.sol` |
| L1 mocks | `test/mocks/{AztecFakes,MockPermit2,Mutants,Permit2Digest,RouterFixture}.sol`; new `test/mocks/Wallets1271.sol` (honest, permissive). `FakeRegistry.rollup` loses `immutable` and gains `setCanonical` (`AztecFakes.sol:71`) |
| L1 formal | `test/Formal{Portal,Router}.t.sol`; `contracts/evm/scripts/halmos-gate.sh` (EXPECTED and the self-test log, counts included) |
| L1 tests | `test/TokenPortal.t.sol` (about 20 call sites; `test_deposit{Public,Private}_namesTheCaller` become "names the refund address" / "names the signer"); `PortalRoundtripFuzz.t.sol:61-82`; `TokenPortalInvariant.t.sol:105-150`; `Permit2DepositRouter{,Fuzz,Invariant}.t.sol`; `WitnessHash.t.sol` (+ the router typehash and `permitDigest` pins); new `FundingAuthorization.t.sol`; `SepoliaFork.t.sol` (+ `permitDigest` == the real Permit2's digest; the 1271 refusal). `.gas-snapshot`, plus direct-path gas tests |
| Fizz/CI | `test/fizz/**`, `medusa.json`, `foundry.toml`, `PROPERTIES.md`, `fizz_data/*` inputs, `.gitignore`, `contracts/evm/package.json` (`test:evm:fuzz`), root `package.json` alias, `.github/workflows/{fuzz-contracts,_contracts}.yml`, `.github/actions/setup-toolchains/{action.yml,medusa-1.5.1.sha256}`, `toolchain.json` |
| Noir | `contracts/aztec/token/src/{hints,main}.nr`; `token/src/test/{hints,utils,merchants,rules_requests,rules_private}.nr`; new `token/src/test/guards.nr` + `mod guards;` in `token/src/test.nr`; `token_bridge/src/test/{claims,exits,utils}.nr`; both `txe-manifest.txt`; `scripts/run-txe-tests.sh` floors; new `scripts/check-stamp-constraint.sh`; `token/target/*.json` (and `token_bridge/target` if its class moves) via `compile.sh`; `contracts/aztec/PROPERTIES.md` |
| bridge-core | `merchants.ts`, `payments.ts` (the rename), `claim.ts`, `deposit.ts`, `abi.ts`, new `funding-authorization.ts` + test, `artifacts.test.ts` (class-id pins), and the tests at `merchants.test.ts:20-60`, `deposit.test.ts:~393`, `payments.test.ts:~43`, `claim.test.ts:63-80`, `abi.test.ts` |
| Integration | `packages/integration/test/merchants.test.ts:26` (`toMatchObject` + an explicit delay check), `deposits.test.ts` (one direct signed portal deposit submitted by a second L1 actor, claimed, binding to the signer), `binding.test.ts` (consent); new `clock/merchant-exit-expiry.test.ts` |
| Demo/deployer | `packages/demo/src/flows.ts`, `packages/deployer/src/{demo,demo-l1,admin,verify}.ts` (`verify`: the signing-domain read-back) |
| Showcase | `apps/showcase/src/live/{actions.ts,actions.test.ts}`, `LiveMode.tsx` (wires `confirm`) |
| Docs | `docs/{architecture,integration,operations,assurance-map,ci-pipeline}.md`, `AGENTS.md` Commands (`test:evm:fuzz`, the tripwire), `implementations-plan/follow-ups.md` |

### 8. Trade-offs and alternatives not taken

See the **Decision ledger**. The forks that mattered are these:
- **The router rule.** Recover the key, versus refuse code plus an SDK portal flow.
- **Binding the submitter,** versus anyone submits.
- **The stamp canary.** A tripwire, versus a mutant artifact.
- **The SDK's scope.** Router-only plus a builder, versus a full portal flow.
- **Signature formats.** 65-byte only, versus also accepting ERC-2098.
- **Demo merchants.** They pay their own bind deposit, versus having alice submit through the portal path.

## Security & Adversarial Considerations

- **Threat model.** The attackers this plan defends against:
  - a shared contract (Multicall3, a forwarder) or a permissive ERC-1271 that wants to be a depositor (F-01, F-02);
  - a mempool watcher who wants to replay or front-run an authorization;
  - a stranger who sends 1 unit to own an unbound account's exit address (the consent lead);
  - a merchant hiding behind a customer's binding, or binding late (F-03, documented);
  - an observer fingerprinting merchants through tx expiries (F-1, F-2, F-4, F-5);
  - an Aztec governance rollup switch;
  - a supply-chain attacker on the new fuzz tools.
- **Least privilege.**
  - The portal and router stay ownerless and pause-less. The only privileged caller is the bound router, for `...For`.
  - No new admin surface.
  - The nightly job has `contents: read` and no secrets.
  - Keyed steps run only through `env-exec` from the keyed worktree, approved by the owner; no agent touches a key.
  - The demo's merchant L1 accounts hold demo funds only.
- **Cryptography.**
  - OpenZeppelin 5.6.1 (`contracts/evm/package.json`), already pinned: `ECDSA.recoverCalldata` (65-byte, low-s, reverts on a zero result) and `EIP712` (`_hashTypedDataV4`, `eip712Domain`), plus `MessageHashUtils.toTypedDataHash`.
  - **Never `SignatureChecker`:** it accepts ERC-1271.
  - The typed-data vectors are computed independently with `cast` and pinned in Solidity and TypeScript.
- **Input validation**, all before any token movement:
  - **Portal:** zero amount, the u128 cap, field recipient, refund address, canonical rollup, deadline, used digest, signer == depositor with the submitter bound.
  - **Router:** the intent rules, plus signer == caller (private).
  - **SDK:** recovered signer == account (private), and consent before binding.
  - **Noir:** no new inputs. The hint stays advice, and a capsule can still pick a valid but worse side.
- **Supply chain.**
  - Medusa is pinned by version and a sha256 checked with `sha256sum -c`. crytic-compile comes from a hash-locked, wheels-only venv.
  - Both tools are ≥ 7 days old by hand (bunfig's `minimumReleaseAge = 604800` covers npm).
  - Actions are SHA-pinned, installs use a frozen lockfile, and there are no new npm deps.
- **Smart-contract risks.**
  - **Reentrancy:** `nonReentrant` stays on every deposit and withdraw. The used bit is written before the pull.
  - **Replay:** blocked by the Permit2 nonce (router), the used digest (portal), the EIP-712 domains, and the L2 message nullifiers.
  - **Front-running:** the router is signer-submitted, and the portal binds its submitter.
  - **Censorship:** unchanged; re-sign with a new deadline.
  - **Reorg:** state and messages reorg together.
  - **Rollup upgrade:** new deposits refuse, exits keep paying, and in-flight deposits are the named residual.
  - **L2 time-of-check:** the hint's horizon equals the read's cap, and the held-exit spec pins that an exit proven before a switch-off cannot land after it.

## Assumptions

**Facts** (verified at `6fd8f98`)
- Direct deposits name `msg.sender` (`TokenPortal.sol:127-158`). Pulls come from `msg.sender` (:273-277). `_requireDeposit` caps only (:263-265). `initialize` caches the rollup once (:109-112). `withdraw` uses the pinned outbox (:201).
- The router passes `msg.sender` as the Permit2 owner (`Permit2DepositRouter.sol:86`) and names it depositor (:126-128). `MockPermit2` ignores signatures and returns a zero separator (`test/mocks/MockPermit2.sol:32-61`).
- OZ 5.6.1 `ECDSA` takes 65-byte signatures only and rejects high-s. `EIP712` rebuilds its separator on a chain-id change.
- Only `claim_private` binds (`token_bridge/src/main.nr:177-183`). The public depositor is hashed and refunded only (:145, :221). Exits never read a depositor (:224-270).
- `probe` reads three fields and decodes the value change only (`hints.nr:140-145`). The horizon formulas are those of the pinned aztec-packages `v6.0.0-rc.1` (`scheduled_delay_change.nr:128`, `scheduled_value_change.nr:64`).
- `SepoliaFork.t.sol` deploys a fresh portal and router against the real Permit2, USDC, registry and Inbox (`:58-61`). Its constants pin those dependencies, so the redeploy moves none of them.
- `compile.sh --check` diffs against HEAD. TXE floors equal the counts: 164, 78, 20.
- The demo cast already derives an L1 key per merchant (`packages/demo/src/cast.ts:32-35`).
- The Slither hash lock already pins `crytic-compile==0.4.2` (`.github/actions/setup-toolchains/slither-0.11.6.requirements.txt:536`), so Medusa's compile front end reuses that venv.

**Inferences** (each has a spike or test that settles it)
- **I1. [S2: partly false]** The low-s acceptance proof passes; the foreign-signer refusal cannot be proven, because `f_ecrecover` is uninterpreted. So the signer rules are forge-only. The original inference: Halmos 0.3.3 models `ecrecover` and `vm.sign` well enough to prove the foreign-signer refusals with a symbolic key. Two planners cite `halmos/sevm.py` and `cheatcodes.py`. Its generated `s` ranges over `0 < s < n`, not OZ's low half (`cheatcodes.py:1260`), so honest signatures in proofs are constrained to low-s, and the high-s refusal stays a concrete forge test. Spike S2 runs through `ECDSA.recoverCalldata` with positive acceptance and foreign-signer refusal. If it fails, use concrete-key proofs or forge canaries. Separately, `proveConservation` and `proveNamesCaller` pin `isPrivate = false` in halmos; their private leg is covered by P4's forge tests and the `RouterWithoutSignerCheck` canary.
- **I2. [S1: confirmed]** Medusa 1.5.1 implements `sign`, `addr` and `prank`, and accepts `--timeout`. The CLI flags override the config, and a failed property exits 7. Codex cites its `standard_cheat_code_contract.go`. Spike S1.
- **I3. [S3/S3b: better than planned]** `vm.signAndAttachDelegation` executes real delegations under `cancun` in forge 1.7.1, so the tests use real 7702. The original fallback: two etches under `cancun` stand in for 7702 (spike S3):
  - the 23-byte designator gives a key-held address code, for the "has code" structure (the delegate is never executed);
  - etching the delegate's runtime at the account emulates the delegated call path, which is what Permit2's `isValidSignature` call exercises.

  A real Prague-runtime test is spike S3b.
- **I4.** Moving the delay globals into `hints.nr` compiles under the `#[storage]` const generic. Spike S4.
- **I5.** TXE can read a call's expiry cap (`private_context_at` + `finish().expiration_timestamp`); this decides SP-34. Spike S5.
- **I7.** MetaMask-style 7702 delegates implement ERC-1271 by recovering their own key, so they keep using the router.
- **I8.** OZ `EIP712`'s immutables are masked by `verify`'s `codeMatches` (`packages/deployer/src/verify.ts:47`), so the bytecode match alone never checks the signing domain. `verify.ts` therefore gains one read-back: the deployed `fundingAuthorizationDigest` for fixed inputs must equal the TS builder's digest for that portal and chain. Checked by `deploy:local` + `verify:local` in Arc 2.
- **I9.** The token_bridge class id may move with the token rebuild. `compile.sh` in Arc 3 settles it.

**Asks.** The owner decided these on 2026-10-04:
- the router checks the key;
- the submitter is bound;
- a static tripwire is the stamp canary.

The owner confirmed two more on 2026-10-04:
- **A1. Smart-wallet users have no SDK deposit flow.** This covers Safe and other ERC-1271 accounts, plus 7702 wallets without ERC-1271.
  - They deposit privately only through the portal's signed path, with an owner EOA as depositor, built by an integrator.
  - The SDK refuses an ERC-1271 contract with `KeyHolderRequiredError`, which names the portal path. A 7702 wallet without ERC-1271 passes that key check and is then refused inside Permit2 (see the Permit2 errors in section 4).
  - Documented in `docs/integration.md` (P6), and filed in `implementations-plan/follow-ups.md` as "an SDK flow for the portal's signed path". It is filed in P6 itself, not only at close-out.
- **A2. A poisoned demo-merchant binding stops testnet onboarding until a redeploy.** The cast's keys are public. It is accepted as a demo residual, with a refusal message that names the recovery.

The keyed runs in Arc 5 each need the owner's `env-exec` approval.

## Phases

**Every phase's gate starts with `bun run lint && bun run typecheck && bun run test`**, plus `bun run lint:actions` when `.github/**` changes. A gate passes only when:
- the intended tests actually ran, with no unexplained skips;
- each expected failure fails for its own reason.

Log every meaningful attempt in `lessons/phase-N.md`. Reassess after 3 failures on the same step.

### Phase 0: Spikes (scratch only, nothing committed) ✓

| Spike | What it checks |
|---|---|
| S1 | A 60 s Medusa run of a throwaway handler using `vm.addr`/`vm.sign`/`vm.prank`; `medusa fuzz --help` |
| S2 | One halmos `check_` with a symbolic-key, low-s-constrained `vm.sign`, through OZ `ECDSA.recoverCalldata`: positive acceptance, and a foreign signer refused |
| S3 | A 7702 designator etched + `prank` + `code.length`, and a delegate's runtime etched at a key-held account answering `isValidSignature`, under `cancun` |
| S3b | A real 7702 delegation (`vm.signAndAttachDelegation`) in an isolated Prague runtime, with production artifacts still built for `cancun` and no shared `out/` touched. Optional |
| S4 | The delay globals moved into `hints.nr`, then `compile.sh token` |
| S5 | A TXE scratch test reading `finish().expiration_timestamp` after a `DelayedPublicMutable` read |

**Gate:** each spike's yes/no is in `lessons/phase-0.md`, and the plan's stated fallback is applied for each "no". S4 and S5 run as P8's first step: only Arc 3 depends on them, and editing Noir sources mid-Arc 1 risks a stray change.

### Arc 1: fizz committed, hygiene, nightly (`worktree-pashov-audit-fizz`)

**P1.** ✓
- `forge fmt test/fizz`, then commit the suite, its inputs and both `PROPERTIES.md` (path stripped). `test:evm` runs `forge fmt --check` over everything.
- Add the `.gitignore` entries; delete `echidna.yaml`.
- Bound the mock mint (GL-26), and rewrite `test_repro_property_l2LiabilitiesFitU128` to assert the bound.
- Add the `toolchain.json` keys, the `setup-toolchains` `medusa` input with its sha256, `fuzz-contracts.yml` and `test:evm:fuzz`.
- Docs: a `docs/ci-pipeline.md` row and an `AGENTS.md` Commands line.

**Gate:**
- `bun run test:evm`: fizz compiles, and FoundryTester passes in the default profile;
- `bun run test:evm:gas` is unchanged;
- `bun run lint:actions`;
- a local `bun run --cwd contracts/evm test:evm:fuzz` with a 10-minute timeout and zero failures;
- a deliberately broken property, made in scratch and never committed, makes `test:evm:fuzz` exit nonzero with that property named;
- `git status` shows no corpus, logs or auditor output.

GitHub dispatches a workflow only from the default branch, so the first `workflow_dispatch` is a post-merge check. Until then, the local bounded run is the evidence.

*Arc 1 loop:* Codex at high (see Post-implementation).

### Arc 2: L1 deposit rules (`pashov-audit-fizz-l1`)

**P2. Portal guards.** ✓
- `_requireNonZero`, `_requireCanonical`, `_requireDepositor`, and the new public signature.
- The `FakeRegistry` setter; every call site moved, fizz's public-deposit handlers included, and fizz's zero-deposit handler now expects `ZeroAmount`.
- Halmos `proveRejectsZero` (public direct + private `...For`), `proveRejectsStaleRollup` and `proveRejectsBadRefund`, each with its mutant, canary, gate pair and self-test log.
- Reachability canaries.
- **Formal helpers.** `proveRecipientInField` (`FormalPortal.t.sol:155-173`) gains `vm.assume(amount != 0)` and `vm.assume(depositor != address(0) && depositor != address(p))`, so it still fails only on `RecipientExceedsFieldMax`. `proveRouterOnly` is unaffected: `NotRouter` fires first. `proveCap`'s public leg is unaffected. Its private leg (`FormalPortal.t.sol:145-149`) moves in P3 to `depositToAztecPrivateFor` under `vm.prank(p.router())`, as `proveRecipientInField` does at :165-173: an unsigned direct call would revert on the signature before the cap. The direct signed cap refusal goes in `FundingAuthorization.t.sol`.

**Gate:** `bun run test:evm && bun run test:evm:formal && bun run test:evm:slither`.

**P3. The signed private deposit.**
- OZ `EIP712`/`ECDSA`, the struct, the used bit, the errors, `fundingAuthorizationDigest`, the hooks.
- `FundingAuthorization.t.sol`:
  - literals for the typehash, domain separator, struct hash and digest, computed with `cast`;
  - a mutation loop over every field;
  - positive: X signs, Y submits and pays, and the message and event name X;
  - refusals, each with its exact selector and no state change:
    - wrong signer;
    - foreign submitter;
    - expired, and at deadline equality (which passes);
    - reused;
    - 64-byte, high-s, garbage;
    - `_depositor = 0`;
    - **signature first:**
      1. choose a placeholder address A and compute `digest(A, …)`;
      2. recover B from a chosen low-s `(r, s, v)` over that digest;
      3. submit naming B.

      Production recomputes `digest(B, …)` and refuses. The `PortalUnsignedDepositor` mutant accepts. The same assertion body runs against both;
    - an honest 1271 wallet;
    - a permissive 1271 wallet.
  - a really delegated 7702 depositor (`vm.signAndAttachDelegation`) signing with its key is accepted.
- Halmos `provePortalExpired` (it refuses before any signature). The signer rules are forge-only, since S2 showed halmos cannot prove a foreign-signer refusal. Forge canaries for:
  - `PortalWithoutReplayCheck`
  - `PortalWithoutSignerCheck`
  - `PortalWithoutDeadline`
  - `PortalIgnoresSubmitter`
  - `PortalUnsignedDepositor`, which leaves `depositor` out of the struct hash and is caught by the signature-first test
- A test that the stock aztec.js selectors revert.
- **Fizz call sites, in this phase** (`forge test` compiles `test/fizz`):
  - `TokenPortalHandler.sol` (:82, :86, :209-226);
  - `RoundTripHandler.sol:202-210`;
  - `AztecL2Handler.sol:152`;
  - `FoundryTester.sol`.

  Each moves to the new private signature, signing with key-held actors.

**Gate:** as P2.

**P4. The router key-holder rule.**
- `_requireSigner` (private only), `permitDigest`, `SignerIsNotTheCaller`.
- `MockPermit2.DOMAIN_SEPARATOR` becomes real, and `RouterFixture` signs with `vm.addr(pk)`.
- Tests:
  - an EOA passes;
  - a key-held account really delegated with `vm.signAndAttachDelegation` passes;
  - a permissive 1271 owner with an empty signature is refused with `permit2.calls() == 0` (the F-02 repro);
  - a stolen signature from another caller is refused;
  - compact and high-s are refused before Permit2;
  - each signed field tampered with the original signature kept (amount, recipient, secretHash, privacy, nonce, deadline) is refused;
  - the public leg is untouched.
- **Formal helpers.** In `FormalRouter.t.sol`, `_depositOutcome` and `_assertRejected` (:161, :180) stop passing empty signatures. Callers become `vm.addr(pk)` and sign the real `permitDigest`, against the router or mutant under test. So `proveConservation` (:88-105) still accepts an honest private deposit, and the intent canaries (:196-244) still fail on their own assertion (`ACCEPTED`, …), never on `SignerIsNotTheCaller`. In halmos, `proveConservation` and `proveNamesCaller` pin `isPrivate = false` (S2). The private leg, and the signer rule's mutant `RouterWithoutSignerCheck` with its canary, are forge tests over real signatures.
- **Fizz, in this phase.** `Permit2DepositRouterHandler.sol` (:24, :58, :83, :108) and `FoundryTester.sol:30` sign with key-held actors over the real `permitDigest`, so the default-profile smoke keeps passing.
- **Real Permit2 and 7702-style accounts** (`SepoliaFork.t.sol`, fork-gated):
  - `permitDigest` == the real Permit2's digest.
  - A key-held account is really delegated: `vm.signAndAttachDelegation(delegate, pk)`. Spike S3b showed that forge 1.7.1 executes the delegate under the repo's `cancun` pin, so Permit2's `isValidSignature` call runs it in the account's context.
  - With an honest-1271 delegate, the deposit passes. The refusals each assert the actual revert and unchanged balances: a wrong-magic delegate gets `InvalidContractSignature`; a delegate with no `isValidSignature`, or a reverting one, gets whatever revert it actually raises. With a permissive delegate and a foreign signature, the router refuses. The same permissive case run against `RouterWithoutSignerCheck` is admitted by the real Permit2, which shows the F-02 mechanism the router's rule closes.
  - The unit suite uses the same real delegation, with `MockPermit2`, for the router's own refusal and acceptance cases.
- Direct-path gas tests. Regenerate `.gas-snapshot` from `contracts/evm` and review the deltas.

**Gate:** P2's gate + `bun run test:evm:gas`, and `SEPOLIA_RPC_URL=<public Sepolia endpoint> bun run test:evm:fork`. If no keyless endpoint serves the fork:
- Arcs 3 and 4 may proceed provisionally, with this gate marked open in the plan.
- It must pass before the first keyed deployment in Arc 5, through an endpoint the owner provides when asked.
- It never runs during a keyed run, and nothing deploys while it is open.

**P5. Fizz properties and campaign, and the L1 TypeScript mirror.**
- The rest of section 6's fizz changes. The call sites already moved in P3 and P4; this phase adds the new properties, the canonical-switch handler and the submitter cases.
- **Deposit liveness under a rollup switch.** `_cleanEnv()` (`test/fizz/Base.sol:242`) gains a deposit-only precondition: the portal's rollup is still canonical. Without it, `adv_depositLiveness` (`handlers/RoundTripHandler.sol:121`) records the correct `RollupNotCanonical` refusal as `depositLivenessBroken`, and GL-29 (`Properties.sol:289`) fails. Withdrawal liveness stays independent of canonicality. `_cleanEnv()` also guards a withdrawal postcondition (`Properties.sol:469`), so the new precondition is added only where deposits are checked, never to that withdrawal guard. A regression sequence pins this: switch the canonical rollup, try a deposit, then check that GL-29 holds and a withdraw still pays.
- `B/abi.ts`, `B/funding-authorization.ts` + its pinned test, `KeyHolderRequiredError` + `deposit.test.ts`.
- A `deposits.test.ts` integration spec: a direct signed deposit submitted by a second L1 actor, claimed, binding to the signer.
  - bridge-core builds tickets only from the router's `Deposit` log, so the spec hand-builds the `ClaimTicket` from the portal's `DepositToAztecPrivate` log. `claimCall` reads only the intent, the secret or salt, `leafIndex` and `depositor`.
  - The consent API lands in Arc 4; until then the current `claimCall` sets the bind flag.
- `verify.ts` reads back `fundingAuthorizationDigest` against the TS builder (I8); `RUN_ID=a2 bun run deploy:local && RUN_ID=a2 bun run verify:local`.

**Gate:**
- `bun run test:evm`;
- `bun run --cwd contracts/evm test:evm:fuzz` with a 30-minute timeout, zero failures, and signed private deposits actually exercised;
- `bun run test:integration`.

**P6. L1 docs.**
- `docs/architecture.md:3,5,7,21-25`: deposits, the funding identity, the residuals, and a rollup upgrade stops deposits.
- `docs/integration.md:42,50,68-78,90-93`:
  - the typed errors;
  - the portal path with `FundingAuthorization` typed data and its submitter;
  - the u128 total;
  - the portal path's prerequisites:
    - approve the portal first (it pulls with `transferFrom`, not Permit2), which is two txs unless batched;
    - `v` is 27/28, since OZ refuses yParity 0/1;
    - a return pays the signer, never the submitter;
    - the depositor derives its own claim salt.
  - A 7702 wallet without ERC-1271 gets `InvalidContractSignature` or an undecodable revert from Permit2 on the router; the next step is the portal path.
- `docs/assurance-map.md` A8, A9, A26, plus a new row for the signed path, naming the real test names.
- `docs/integration.md` "Smart-contract wallets": they have no SDK private deposit. Use the portal's signed path with an owner EOA as depositor; the account's exits then go to that EOA.
- `implementations-plan/follow-ups.md`, in the "Before mainnet" section: "An SDK flow for the portal's signed path (smart-contract wallets, 7702 wallets without ERC-1271)" (owner, 2026-10-04).
- Why the router, not the portal, checks the Permit2 signature: the portal never receives it. The router is the one bound, ownerless contract whose `...For` the portal trusts, so it belongs to the portal's trusted base. `docs/architecture.md` says so in one sentence.

**Gate:** `bun run lint`.

**P7. L1 re-audit.**
- The solidity-auditor, 3 passes, over `contracts/evm/src`, seeded with the 2026-10-02 ledger as known findings.
- A Medusa campaign of at least 1 hour over the new portal and router.
- Triage everything into this arc. A finding that needs a new rule gets its proof, mutant and canary.
- Accepted and rejected findings, with reasons, go into this plan's **Re-audit verdicts**.

**Gate:**
- every Arc 2 gate re-run;
- no open finding at confidence ≥ 75;
- every lead has a written disposition;
- every shrunk sequence is a harness fix with a regression test or a contract fix.

*Arc 2 loop:* Codex at high.

### Arc 3: Aztec hints, mirror, tests, tripwire (`pashov-audit-fizz-aztec`)

**P8. Hint horizons and call sites.**
- First, spikes S4 and S5 (Phase 0's table). Record them in `lessons/phase-0.md`.
- The `Entry`/`probe`/`merchant_side_hint` rewrite, the two call sites, the rename, the moved globals and the comment fix.
- Promote `switch_off` from `test/hints.nr:76-80` into `utils.nr`.
- TXE tests:
  - rewrite the tie-break test as `of_two_merchants_the_probe_proves_the_one_with_the_later_cap`, and rename it in the manifest;
  - add a delay-aware test (1 h against 24 h; a pending decrease two hours in, then after it lands);
  - add the literal-horizon cases, through a new `pub unconstrained fn merchant_horizon(list, account) -> u64` in `hints.nr` (`Entry` and `probe` stay private). It is a module function, not a contract entry point, so the ABI does not change;
  - SP-33 `public_to_private_proves_a_merchant_sender_not_the_hidden_recipient` and its private→public twin, as real calls;
  - SP-34, which checks expiry caps by value. If S5 passes, it is a TXE test reading the raw cap. If a full call cannot expose the cap, the entry-level fallback reads it: `DelayedPublicMutable::new(context, slot).get_current_value()` inside `private_context_at`, then `finish().expiration_timestamp`. If neither works, the held-exit spec (P11) gives partial integration coverage only: `committedExpiry` rounds to hours, and it covers a scheduled switch-off but not every pending-decrease case. The table says "partial". `PROPERTIES.md`'s stale SP-34 line, "a stamp adds no cap", is corrected: `main.nr:1161` sets one.
- `compile.sh`, commit the artifacts, then `compile.sh --check`. Update the class-id pins in `B/artifacts.test.ts`.

**Gate:**
- `bash contracts/aztec/scripts/compile.sh --check`;
- `bun run test:noir`, with the new floors met;
- `bash contracts/aztec/scripts/check-sole-consumer.sh --self-test && bash contracts/aztec/scripts/check-sole-consumer.sh`;
- `bun run --cwd contracts/aztec test` (artifact identity, ABI superset).

**P9. The bridge-core horizon mirror.**
- The `MerchantEntry` fields and the helpers; `merchantSide`.
- The same literal cases.
- The `payments.ts` rename; the literals in `deposit.test.ts` and `payments.test.ts`; the integration `toMatchObject`.

**Gate:** the base gate.

**P10. The top-10 property tests.**

| Property | Test |
|---|---|
| SP-36 | `a_message_from_another_l1_sender_cannot_be_claimed`, with 4 twins: both claims and both returns. Both message helpers in `token_bridge/src/test/utils.nr:75-104`, private and public, gain sender-taking siblings |
| GL-06 | New `token/src/test/guards.nr`, 5 tests mirroring `token_bridge/src/test/guards.nr` |
| SP-26 | Extend `merchants.nr:282` with a merchant, a stranger, the guardian, and the proposed admin before it accepts |
| SP-50 | A stranger cannot spend a victim's burn authwit, public and private, and the victim can still exit with it afterwards; beside `exits.nr:192-213` |
| SP-02 | `no_transfer_or_request_moves_the_total_supply` |
| SP-14 | `naming_a_merchant_completer_does_not_let_a_user_open_for_a_user` |
| SP-49 | Pinned as the accepted behaviour: `a_switched_off_merchant_that_never_bound_binds_late_and_exits_there` |
| SP-30, SP-33 | Covered in P8 |
| SP-34 | P8 (TXE, the raw cap, by call or entry-level read). Failing both: P11, marked partial |

- SP-07 is dropped: it is covered at `rules_requests.nr:257`.
- `contracts/aztec/PROPERTIES.md`: SP-49 and finding 1 become accepted behaviour; SP-07 and SP-26 are marked covered.
- Each new name goes in its manifest, with the floor bumped by the same count.

**Gate:** as P8.

**P11. Held exit and tripwire.**
- `packages/integration/clock/merchant-exit-expiry.test.ts`, from the `stamp-expiry.test.ts:139-173` template:
  - `holdSends`;
  - an un-awaited `exitToL1({asMerchant: true})` proven while a switch-off is scheduled;
  - the merchant is listed with the 1 h delay (the `stamp-expiry.test.ts:84-87` pattern). With 24 h, the standard 82 800 s expiry is lower than the cap, and the test would pass vacuously;
  - assert the held record's expiry equals `committedExpiry(record, changeAt − 1)`;
  - `warpTo(changeAt)`, `release()`;
  - assert `refused === true` with no burn and no L2→L1 message;
  - a positive exit before expiry, as a separate case.
- `check-stamp-constraint.sh` with `--self-test`, wired into `_contracts.yml`.

**Gate:**
- `bun run test:integration` (the specs and the clock suite);
- `bash contracts/aztec/scripts/check-stamp-constraint.sh --self-test && bash contracts/aztec/scripts/check-stamp-constraint.sh`;
- `bun run lint:actions`.

**P12. Aztec docs.**
- `docs/architecture.md:45-52`: Expiry gains the pending-delay-decrease cap, the horizon rule and "the hint is advice".
- `docs/integration.md:18,58,99`: the linkability section names the remaining fingerprint.
- `docs/operations.md:72,75,79-87`.
- `docs/assurance-map.md` A5, A21, with the real test names.

**Gate:** `bun run lint`.

**P13. Aztec re-audit.**
- The Aztec.nr lens, 3 passes, through `reaudit/setup-noir.sh`, `build-bundles.sh - <bundle> <refs> reaudit/aztec-nr-overlay.md` and `record-pass.sh`, over the changed Noir.
- Triage into this arc, and record verdicts in **Re-audit verdicts**.

**Gate:** P8 + P11 re-run; no open finding at confidence ≥ 75; every lead dispositioned.

*Arc 3 loop:* Codex at high.

### Arc 4: consent, onboarding, remaining docs (`pashov-audit-fizz-sdk`)

**P14. `allowBind`.**
- `claim`, `waitClaimable`, `claimCall`, `BindConsentRequiredError`; the `castClaim` opts; the showcase confirm.
- Tests:
  - `claim.test.ts`: with `allowBind`, a first claim binds (arg `1n`); without it, it throws with zero simulations and zero sends; a bound account never prompts.
  - `flows-mocked.test.ts`: `castClaim` forwards consent.
  - showcase `actions.test.ts`: an unbound recipient prompts, a decline sends nothing, an accept passes `allowBind`.
  - `binding.test.ts` integration: refused without consent, binds with it.
- `packages/integration/test/actors.ts` (:94 `waitClaimable`, :101 `claim`, `funded()` at :104) passes `allowBind: true` explicitly: these are trusted funding fixtures. The refusal tests use the unconsented API.
- The Arc 2 portal spec switches to `allowBind`.

**Gate:** base gate; `bun run test:integration`; `bun run --cwd apps/showcase test:components`.

**P15. Bind before listing.**
- The demo seeds and their order; `demo fund` funds the merchants; the `merchants add` reminder.
- The two-phase testnet stop, with a unit test of the seed order and the "list now" stop.
- The `docs/operations.md:13,51,71,89-97` runbook.

**Gate:** `RUN_ID=p15 bun run net:up && RUN_ID=p15 bun run deploy:local && RUN_ID=p15 bun run bridge demo setup local && RUN_ID=p15 bun run bridge smoke local`, then `RUN_ID=p15 bun run net:down`.

**P16. The remaining leads, in docs.**
- F-03 by design: the stolen-key race, bind-before-listing, a switch-off demotes rather than freezes. The Emergency runbook (`operations.md:79-87`) no longer implies that a switch-off ends every cash-out.
- Merchants claim before they deliver, because a private deposit is clawable until it is claimed.
- A public deposit is returnable while its merchant is off.
- Keep one delay for every merchant (the admin delay fingerprint).
- A payer who opens a request writes its log, at both sites.
- The pad rule lives in the hint.
- `try_prove_merchant`'s `false` is only a claim.
- A merchant is bound to its first private payer.
- A7: the bridge mints and burns through the proxy, and holders can burn their own tokens with an authwit.
- Rules by role in the "Claim a deposit" rows.

**Gate:** `bun run lint`.

**P17. End-to-end.**

**Gate:**
- `bun run test:e2e`, in which try-happy still settles and `demo setup` binds and then lists on local;
- `bun run --cwd apps/showcase test:components`;
- `bun run test:integration`.

*Arc 4 loop:* Codex at high, then the **cross-arc pass** (Post-implementation, step 2), before any keyed run.

### Arc 5: keyed testnet redeploy (`pashov-audit-fizz-testnet`, blocks on the owner)

**P18.**
- Commit and push. `bash scripts/keyed-worktree.sh sync`.
- Keyless `bun run probe:testnet`.
- The owner approves each `env-exec` run from the keyed worktree:
  1. `deploy testnet` + `demo fund`;
  2. `admin accept`;
  3. keyless `demo setup` (binds the merchants, then stops);
  4. `merchants add <galactica> <supplier>`;
  5. keyless `demo setup`;
  6. `smoke --record deployments/testnet-tour.json`.
- Nothing is installed, built, tested or committed on the host while a keyed run is live.
- Copy back `deployments/testnet{,-demo,-tour}.json`, then `keyed-worktree.sh remove`.
- `bun run --cwd apps/showcase build:testnet`, push, then test the Workers Builds preview.
- Delete the redeploy follow-up.

**Gate:**
- `bun run bridge verify deployments/testnet.json --tour deployments/testnet-tour.json`;
- `SEPOLIA_RPC_URL=… bun run test:evm:fork`;
- `SHOWCASE_URL=<preview> bun run --cwd apps/showcase test:testnet`;
- `build/manifest-identity.test.ts`;
- the base gate.

*Arc 5 loop:* Codex at high over the manifest and doc diff.

### Close-out (`pashov-audit-fizz-close-out`, docs only)

See Delivery.

## Post-implementation

1. **At each arc boundary,** after the arc's gates and its re-audit phase, and before `gh stack add` opens the next arc:
   - Run `/codex high` over `git diff <arc-base>...HEAD`, with:
     - this plan and its Decision ledger;
     - the arc map ("arc N of 5; later arcs build …", so that reserved seams are not flagged);
     - the adversarial ask: "What could go wrong? What would an attacker target? What are we trusting that we shouldn't?";
     - both rules below, verbatim.
   - Triage: verify every claim against the repo, fix, commit, and log the round and its verdict in `lessons/phase-N.md`.
   - Resume the same Codex session with the fix diff.
   - Repeat until a round has no material finding. After 3 rounds, stop and surface to the owner, expecting "keep going, minimal fixes".
2. **Cross-arc pass,** after Arc 4's loop and before any keyed run, so the deployed bytes are final. A fresh `/codex high` session over `git diff 6fd8f98...HEAD` asks for:
   - seams between arcs;
   - ABI and signature drift between Solidity, the TS mirror and the fizz model;
   - consent propagation;
   - artifact identity;
   - onboarding order;
   - duplication;
   - drift from this plan.
   Run the same loop. Arc 5 gets its own small loop.
3. **Each loop also checks:**
   - no comment names a plan, phase, audit or finding id (the portal header, the `hints.nr` header and the `_prove_merchant_side` docs are the likely offenders);
   - every halmos proof has its mutant, canary and gate pair;
   - every TXE test has its manifest name and floor bump;
   - `token_bridge/src/main.nr` is unchanged;
   - the ABI-superset lists are unchanged;
   - `[profile.fuzz]` is never set outside the Medusa step;
   - cognitive complexity ≤ 15 and ≤ 80 lines per production function.
4. **Delivery,** then **close-out**, as below. No `/code-review`: it is off.

The no-over-engineering rule, verbatim in every Codex prompt, initial and resumed:

> Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone.

The comment-quality rule, verbatim in every Codex prompt:

> Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact.

## Delivery

| Arc | Branch | Phases | Stacks on | code-review |
|---|---|---|---|---|
| 1. Fizz, hygiene, nightly | `worktree-pashov-audit-fizz` | P0-P1 | `main` | off |
| 2. L1 deposit rules | `pashov-audit-fizz-l1` | P2-P7 | 1 | off |
| 3. Aztec hints and tests | `pashov-audit-fizz-aztec` | P8-P13 | 2 | off |
| 4. Consent, onboarding, docs | `pashov-audit-fizz-sdk` | P14-P17 | 3 | off |
| 5. Testnet redeploy | `pashov-audit-fizz-testnet` | P18 | 4 | off |
| Close-out | `pashov-audit-fizz-close-out` | close-out | 5 | off |

- **Stack mechanics:**
  - `gh stack init --adopt worktree-pashov-audit-fizz`;
  - `gh stack add <next>` at each arc boundary, after that arc's loop converges;
  - branches may be pushed for checkpoints;
  - no PR, not even a draft, until every loop including the cross-arc pass has converged;
  - then `gh stack submit --auto`, a proper body via `gh pr edit` on each PR, and `gh pr checks --watch`.
- **Close-out layer:**
  - `gh stack add pashov-audit-fizz-close-out`;
  - an `## Outcome` block after the front matter: date, what shipped, PR numbers, what was dropped and why, the accepted residuals, and an explicit retirement of the `/goal` and `/loop` seeds;
  - promote the generalizable lessons into `implementations-plan/lessons.md` with a pruning pass inside its ~8 KiB budget. Candidates:
    - "halmos 0.3.3 models ecrecover and vm.sign (its `s` spans the high half too, so constrain honest signatures to low-s) and treats sha256 as uninterpreted: order signature rules before any hash";
    - "`forge test` compiles untracked files under `test/`";
    - "a hint-side `unpack_delay_change` needs the storage's INITIAL_DELAY";
  - move the open follow-ups into `follow-ups.md`: an SDK flow for the portal path, `probe` reading the demo accounts' code, and a mutant-artifact canary if ever wanted. Delete the resolved redeploy item;
  - reconcile the three shared files against trunk;
  - `git mv implementations-plan/pashov-audit-fizz implementations-plan/archive/pashov-audit-fizz` in its own commit, with the relative links repaired;
  - move the index line to `archive/index.md`;
  - `gh stack submit --auto`;
  - the final report names the post-merge check: one `workflow_dispatch` of `fuzz-contracts.yml` on `main`.
- **Merging** is `gh stack merge --squash` on the close-out, and it is the owner's call.

## Seeds (final, approved 2026-10-04)

ELI5 companion: https://claude.ai/artifact/4742YbhxmF4tLSmJKBd2rh. Its source is `eli5.html` in this folder; it is gitignored, and republishing the same file keeps the URL.

Run inside this worktree (`agent-worktree resume pashov-audit-fizz`), in the permission mode intended for unattended work. Use exactly one seed per session: they don't compose. **Recommended: `/goal`.** Completion is observable in the transcript (gates, loop verdicts, `gh stack view`).

```
/goal All phases P0–P18 are marked ✓ in implementations-plan/pashov-audit-fizz/plan.md (the phase headers in the file, not the chat or task list), each ✓ backed by its phase's validation gate, as written in plan.md, reported passing in the transcript; for each phase the agent has printed LESSONS_FILE=implementations-plan/pashov-audit-fizz/lessons/phase-N.md; plan.md's code_review is off, so /code-review was NOT run; the Codex fix loop (/codex high, with the plan's no-over-engineering and comment-quality rules verbatim) converged at each arc boundary (Arcs 1–5) and in the fresh cross-arc pass before any keyed run, each convergence evidenced by a resumed Codex pass reporting no new material findings, quoted in the transcript; plan.md's "Re-audit verdicts" lists every P7 and P13 finding as accepted or rejected with a reason; every Arc 5 keyed run executed only after the owner approved its env-exec request in this conversation, and no secret value appears in the transcript; the Delivery section's stack (5 arcs + pashov-audit-fizz-close-out) exists on GitHub, created only after all loops converged (gh stack view output in the transcript), with the close-out's archive-move commit shown by git show --stat; bun run test and bun run lint both report exit 0 in the transcript. Never merge, never push to main, never generate or print a key.
```

Fallback, only if `/goal` is unavailable:

```
/loop 15m Drive implementations-plan/pashov-audit-fizz forward. Never idle waiting for my input. Each firing:
1. Reality check: read implementations-plan/pashov-audit-fizz/plan.md (Outcome & Quality Bar first) and lessons/ — the authoritative state, not the chat. On the stack, read them from the TOP layer (gh stack view; git show <top-branch>:<path>). If plan.md is gone: git fetch -q origin && git cat-file -e origin/main:implementations-plan/archive/pashov-audit-fizz/plan.md → merged, STOP and say so; otherwise delivered and awaiting my merge → babysit CI only, then STOP once green. A live plan.md with an ## Outcome block means an interrupted close-out: finish it. Empty task list? Rebuild it from plan.md's phases; git status; git log --oneline -5.
2. Waiting on CI or on my env-exec approval for an Arc 5 keyed run is fine: prep the next step meanwhile, never start a keyed run unapproved, and never install, build, test or commit on the host while a keyed run is live.
3. No task in hand? Take the next pending step in plan.md. After each meaningful edit, run bun run lint, bun run typecheck and the touched suites; commit (signed per ~/.agents/machine.md); gh stack push.
4. Stuck, or facing a decision you'd bring to me? /codex high with full context until you reach a defensible decision; log the consult and verdict in lessons/phase-N.md. Hard limits stay hard: never merge, never push to main, never deploy or run a keyed command without my approval, never handle a secret, never expand scope beyond plan.md.
5. Same step failed 5 times? Reassess with Codex, then continue on the agreed path.
6. Phase green = its validation gate in plan.md passes: paste the result, mark ✓ in plan.md, write lessons/phase-N.md, print LESSONS_FILE=…, advance. At an arc boundary: run the arc's Codex loop (/codex high, arc diff, the arc map, the adversarial ask, the no-over-engineering and comment-quality rules verbatim) until a round yields nothing material, THEN gh stack add <next-arc-branch>. At the Arc 4 boundary, after its loop and BEFORE any Arc 5 work: run the fresh cross-arc Codex pass (new session, net diff from 6fd8f98) until clean. Arc 5's keyed runs start only after it converges.
7. All phases ✓: Delivery per plan.md (gh stack submit --auto, gh pr edit bodies), then the close-out layer, then gh pr checks --watch. Write the wrap-up: what shipped, every contested decision with ELI5 context, open items, and the post-merge check (dispatch fuzz-contracts.yml once on main). Stop: merging is my call.
```

## Plan audit verdicts

**Contradiction check** (Codex and Fable, 2026-10-04): 12 + 16 items, all adopted (ledger #25). The material ones:
- the depositor was missing from the signed struct (Codex);
- the fizz and formal call sites broke gates before the phase that fixed them (both);
- `--test-limit` cut the campaigns short (both);
- the merchant bindings were not finalized and read back before listing (Codex);
- `actors.ts` was missing consent (Codex);
- proof helpers would fail for the wrong reason (both).

**Codex audit, round 1** (resumed planner session): *approve with the listed fixes*. All 9 adopted:
- Permit2's refusal for a 7702 wallet with no ERC-1271 is not always `InvalidContractSignature`, so the tests assert the actual revert;
- the client pre-check validates 65 bytes and low-s, and translates recovery errors;
- `stopOnNoTests` does not prove property discovery, so the job checks the log for the `property_*` names;
- halmos's `s` spans the high half, so honest proof signatures are constrained to low-s;
- the signature-first test is made constructible, through a `_fundingStructHash` hook for its mutant;
- the tripwire reuses the control-flow and depth checks and gains a dead-branch mutant;
- the SP-34 fallback is the entry-level raw-cap read, else it is marked partial;
- `verify` reads back the signing domain;
- a deferred fork gate must pass before any keyed deployment.

**Fable audit** (fresh context, not shown the drafts): *approve with the listed fixes*. It found that the signed path withstands forgery, grinding, malleability, the fork path, same-domain collision, a foreign submitter, replay and L2 binding. All 17 items were adopted:
- **Material:** `proveCap`'s private leg moves to `...For`.
- **The rest:**
  - halmos pins `isPrivate = false` for the two router proofs;
  - Permit2's refusal is not always decodable;
  - two residuals are named: the L1 depositor is not the L2 account, and the unsigned refund address allows pay-to-taint;
  - `_requireDepositor` also refuses the router;
  - the portal-path prerequisites are documented;
  - the recovery throw is caught;
  - consent is checked before polling;
  - the re-claim after a prune forwards consent;
  - the tripwire refuses `unconstrained` and requires the call site;
  - the aztec-nr citation is corrected;
  - `forge fmt test/fizz`;
  - the corpus cache gets `restore-keys`;
  - the probe trade-off is documented.

Two items became gate confirmations (Asks A1, A2).

**Final fresh Codex pass** (new session, no prior context): `conditional approve (with conditions: adapt deposit-liveness checks for canonical-switch states and correct the fallback seed's cross-arc review order)`. Both conditions are applied: P5's GL-29 precondition and regression sequence, and the `/loop` seed's step 6. The minor item is also applied: the SDK pre-check requires `v` ∈ {27, 28}. No additional Asks.

**Confirmation pass** (new Codex session, at the owner's request for an unconditional verdict): **`approve`**. It found both conditions correct and complete, and no new material issue. It also judged the trust boundary sound: the portal never receives the Permit2 signature, and no cheap portal-side check closes a real gap. A code-length check would refuse the supported 7702 accounts, and an address comparison cannot show consent. Both minor notes are applied: the canonical precondition never suppresses `_cleanEnv()`'s withdrawal guard, and A1 states which refusals `KeyHolderRequiredError` covers.

## Re-audit verdicts

_Filled in during P7 and P13: each finding, accepted or rejected, with the reason._

## Decision ledger

| # | Decision | Source | Rejected alternative, and why |
|---|---|---|---|
| 1 | The router recovers the Permit2 digest and requires signer == caller (private) | Main + Fable; **owner, 2026-10-04** | Refusing code + an SDK portal flow (Codex, and the brief's first rule). It refuses every 7702 wallet that deposits today, and needs a second SDK flow to bring them back |
| 2 | The SDK stays router-only; the portal path gets a builder, docs and an integration spec | Main + Fable | A full SDK portal route (Codex). With #1 it only serves 7702 wallets without ERC-1271; follow-up |
| 3 | `FundingAuthorization(address depositor,address submitter,uint256 amount,bytes32 secretHash,uint256 deadline)`, with submitter = `msg.sender` at hashing | Codex (hashing, and the contradiction check's signature-first attack) + Main; **owner** (submitter) | No submitter (Fable): it leaves a pay-to-taint front-run. No depositor in the struct (Fable, and the first consolidation): forgeable. Pick a signature, recover its address, name it, and a keyless depositor passes |
| 4 | An explicit `_depositor`, with `recoverCalldata` == `_depositor` | all three | Naming the recovered address: a malformed signature would strand the account |
| 5 | A used-digest mapping | all three | A nonce bitmap: cancellation machinery the deadline makes unnecessary. No protection: replays |
| 6 | 65-byte signatures only (OZ), refused with a typed error | Main + Fable | ERC-2098 via OZ's compact overload (Codex): extra decode surface, no consumer |
| 7 | Depositor first in both new direct ABIs, matching `...For` | Codex | Appending (Main, Fable): inconsistent with the router-only functions |
| 8 | Zero and canonical guards on every deposit path, never in `withdraw` | all three | — |
| 9 | One `internal virtual` hook per new rule | Main + Codex | Folding zero into `_requireDeposit` (Fable): it would rewrite `PortalWithoutCap` |
| 10 | Halmos for refusals before `sha256`; forge canaries for reuse and the positive paths | Fable + Codex (halmos models `ecrecover`) | Forge-only (Main's first draft): halmos can do more |
| 11 | 7702 under `cancun`: the etched designator (structure), plus the delegate's runtime etched at a key-held account on the fork with the real Permit2 (the 1271 call path). A real-7702 Prague runtime is spike S3b | Fable + Codex (the contradiction check: the designator alone never exercises Permit2) | Changing `evm_version` globally: it moves every artifact and the gas snapshot |
| 12 | `Entry.horizon` replaces `pending`; ties pick FIRST; return early at the maximum horizon; rename to `keep_first` | Fable + Codex | Keeping `pending` beside it: no reader. Two flags: one meaning |
| 13 | `merchantStatus` keeps its shape; a new `merchantHorizon`; flat delay fields | Fable (flat) + Main (shape) | Adding `horizon` to the status (Codex): it breaks the strict `toEqual`s for no consumer |
| 14 | TXE and TS assert the same literal horizons | Main + Codex | Keystone vectors (Main's first draft): keystone holds constants, and the probe is testable in TXE directly |
| 15 | The stamp canary is a static tripwire | Main + Fable; **owner** | A mutant-artifact integration test (Codex): about 1-2 days of harness for aztec-nr's kernel guarantee; follow-up |
| 16 | Consent in both `claim` and `waitClaimable`; thrown before simulation; `castClaim` never defaults it | Codex + Fable | Simulating without consent (Main): it builds a binding call unasked |
| 17 | Client-side signer pre-check (`recoverTypedDataAddress`) → `KeyHolderRequiredError` | Main + Codex; name from Fable | Decoding the revert from `estimateContractGas` (Fable): costs an RPC round-trip and is less precise |
| 18 | Demo merchants bind with their own cast L1 accounts through the router; the bindings are finalized and read back before listing; two-phase testnet `demo setup` | Fable + Main; read-back from Codex | `demo bind-merchants` with alice submitting through the portal (Codex): it needs a portal ticket source in the demo. The integration spec covers the portal path |
| 19 | Arc order: fizz first, then L1, Aztec, SDK, testnet; a re-audit at the end of each code arc | Fable (order) + Main (per-arc re-audit) | Re-audit as its own arc (Fable, Codex): its fixes would land away from the code they fix |
| 20 | A nightly `fuzz-contracts.yml` of 60 min (`--timeout 3600 --test-limit 0`), with crytic-compile from the Slither lock | Fable + Codex | A repo runner script: no need once `--timeout` is passed |
| 21 | `SepoliaFork.t.sol` pins stay; the fork suite gains the `permitDigest` and 1271 cases | Codex (correction) | Moving pins at the redeploy (Main, Fable): wrong, the suite deploys fresh contracts |
| 22 | SP-07 dropped (covered); SP-49 pinned as accepted; SP-34 fills the slot, in TXE if S5 passes, else at the integration layer | all three; fallback from Codex | — |
| 23 | Commit `contracts/aztec/PROPERTIES.md` too; delete `echidna.yaml` | Main + Fable | — |
| 24 | EIP-712 domain name `"InferenceMoneyTokenPortal"`, version `"1"` (25 chars, fits OZ ShortStrings). It is a permanent vector input | Main + Codex | `"TokenPortal"` (Fable): a wallet showing it can't tell this portal from the canonical Aztec one. The domain is separated by address anyway |
| 26 | `_requireDepositor` also refuses the router as a refund address | Fable audit | Leaving it to the caller (the threat appetite): it is one comparison against a protocol-owned sink |
| 25 | Contradiction-check fixes, applied: signature-first refusal + `PortalUnsignedDepositor` canary; field-tamper tests on the router; formal helpers sign and keep valid unrelated inputs; fizz call sites move in the phase that breaks them; `--test-limit 0`; merchant bindings finalized and read back before listing; `actors.ts` consent; Permit2's errors decoded; `smoke` never consents; held exit on a 1 h merchant with equality; SP-26/SP-50 cases restored; a broken-property CI check | Codex + Fable | — |
