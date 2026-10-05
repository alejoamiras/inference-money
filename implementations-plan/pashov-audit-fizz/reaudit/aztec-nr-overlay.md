# Aztec.nr lens — this scan audits Noir, not Solidity

The source at the top of your bundle is **Aztec.nr** (Noir contracts for the Aztec L2), not
Solidity. The SOP, your specialty and the shared rules above were written for Solidity. Keep
their mindset and their output format exactly; translate their vocabulary with this file. Where
your specialty names a Solidity mechanism with no Aztec equivalent (delegatecall, flash loans,
`msg.value`, ERC-4626), drop it and spend the time on the Aztec classes below instead.

## The system in one paragraph

`Token` is a fork of aztec-standards' Token that adds a merchant list: users may pay only
merchants, merchants pay anyone. `TokenBridge` moves the token between Ethereum and Aztec through
the L1 `TokenPortal` (Inbox/Outbox messages): it mints and burns through `TokenMinterProxy`, whose
sole minter is the bridge. A user account is bound, by its first private claim, to the Ethereum
address its deposit came from (its **funding address**) and may withdraw only there; merchants
exit anywhere but the portal. A deposit nobody may claim goes back to its depositor. Libraries:
`claim_secret` (derives the L1→L2 message secret from salt + recipient), `merchant_stamp`,
`portal_messages` (the L1↔L2 content hashes, which must equal the Solidity encodings byte for
byte), `hints` (unconstrained helpers). The design's two promises are **value** (no mint without
a backed deposit, no double consumption, the reserve covers the supply) and **compliance with
privacy** (the role rules above hold, and checking them publishes no party of a private transfer).

## Where to read beyond the bundle (read-only)

- Upstream Token this fork must stay an ABI superset of: `~/nargo/github.com/AztecProtocol/aztec-standards/v6.0.0-rc.1/src/token_contract/src/main.nr`. **Diff the fork against it.** Every changed line is a place where the fork's reasoning replaced upstream's.
- aztec-nr itself (state vars, notes, nullifiers, authwit, messaging, partial notes, history proofs): `~/nargo/github.com/aztec-labs-eng/aztec-nr/v6.0.0-rc.1/aztec/src/` and `.../uint-note`, `.../balance-set`. Read the library when a guarantee depends on what it does.
- The L1 side: `contracts/evm/src/TokenPortal.sol`, `Permit2DepositRouter.sol`.
- Intent and threat model: `AGENTS.md` (Rules), `docs/architecture.md`, `docs/integration.md`, `docs/assurance-map.md`, `implementations-plan/archive/galactica-compliant-usdc/plan.md` (decisions and threat-model rows). Tests: `contracts/aztec/*/src/test/`.

## Vocabulary translation

| Solidity term in your files | Aztec.nr meaning here |
| --- | --- |
| `msg.sender` | `self.msg_sender()`. In a private function it is the calling contract or account contract; any account contract may be the caller. |
| modifier / `require` | `assert(cond, "msg")`, `#[only_self]`, `#[initializer]`, `#[view]`, `#[noinitcheck]` |
| `external` / `public` | `#[external("private")]` (proved client-side, sees only the anchor block), `#[external("public")]` (executed by the sequencer, sees current state), `#[external("utility")]` (off-chain only, **proves nothing**) |
| storage slot | `PublicMutable`, `PublicImmutable`, `PrivateImmutable`, `PrivateMutable`, `PrivateSet`, `Owned<…>`, `Map`, `DelayedPublicMutable` |
| ERC20 balance | private notes (UintNote in a balance set) plus a public balance map; `total_supply` is public |
| approval / permit | authwit (`authwit_nonce`; a private or public authorization message the owner signs or pre-approves) |
| external call | `self.call(...)` (same phase), `self.view(...)` (static), `self.enqueue(...)` / `self.enqueue_self.f()` (a **public** call that runs after all private execution, with its selector and arguments **published**) |
| reentrancy | public re-entry is possible; private has no reentrancy, but nested private calls share one tx |
| `uint256` overflow | `Field` arithmetic wraps **mod p silently**; `u128`/`u64` arithmetic is checked; `field as u128` **truncates** to the low bits |
| event | a log or a note delivery (`MessageDelivery::onchain_constrained` / `onchain_unconstrained` / offchain) |
| block.timestamp / state read | a private function reads **historical** state at its anchor block; public reads current state |

## Aztec bug classes — hunt these in your specialty

1. **Unconstrained values used as truth.** Anything returned by an `unconstrained` fn, an `unsafe { }` block, an oracle or a `hints` helper is attacker-chosen in the prover until a constraint pins it. Find each hint and the constraint that should follow; a missing or partial constraint is a soundness bug. A check made only inside a `#[external("utility")]` fn is no check.
2. **Private → public leaks.** Every `enqueue` publishes the target, selector and arguments, and the enqueued call's `msg_sender` (the contract). A public read or write from a private flow reveals who acted. The project's rule: merchant checks are **private proofs at the anchor block**, never public calls, because a public call would publish both accounts of a private transfer. A leak of an address or amount the design promises to keep private is a finding; the proof is the exact public datum that reveals it.
3. **Anchor-block staleness (TOCTOU).** A private proof checks state as of the anchor block; the tx lands later. A merchant removed, a pause set or an owner changed after the anchor block but before inclusion: which rules still accept the old state, and what does that buy? Check what expiry (`include_by_timestamp` / max block) bounds the window.
4. **Nullifier design.** Missing nullifier → double spend or double claim. A nullifier that is the same for two distinct actions → one blocks the other (squatting). A nullifier computable from public data → anyone links it, or emits it first to block the victim. Check `consume_l1_to_l2_message`'s nullifier: claim and return of one deposit must collide on purpose.
5. **Note integrity and delivery.** Who chooses a note's owner, amount and randomness? `onchain_unconstrained` delivery lets the sender lie about content; can a recipient be made to miss a note or accept a fake? Can a note be created for someone who never asked (binding a stranger)?
6. **Binding of cross-domain messages.** For each L1→L2 consumer: what does the content hash bind, what does the secret bind, which party is never bound? For each L2→L1 message: does the L1 side decode the same fields in the same widths (`portal_messages` vs `TokenPortal.sol`)? Fields above 2^160 for an `EthAddress`, amounts above u128, field values above p.
7. **Authwit misuse.** Replay across functions or contracts, a nonce of 0 meaning "self", an authwit checked for the wrong `on_behalf_of`, a private authwit consumed in public or the reverse, an action that should require an authwit and does not.
8. **Initialization and roles.** `#[initializer]` front-running (an Aztec address commits to its deployer and init hash — check what the deployment actually commits), functions callable before init (`#[noinitcheck]`), `PublicImmutable` set once, two-step ownership, the sole-minter assumption of `TokenMinterProxy`, `generic_proxy` and contract-class upgrades.
9. **Private/public variant asymmetry.** Most operations exist twice (`transfer_private_to_public` / `transfer_public_to_private`, `claim_public` / `claim_private`, `return_deposit_public` / `return_deposit_private`, `exit_to_l1_public` / `exit_to_l1_private`, `mint_to_*`, `burn_*`, the `*_to_commitment` partial-note flows). A rule enforced on one variant and missing on its twin is the commonest fork bug.
10. **Partial notes and commitments.** A commitment completed twice, completed by someone other than its creator, completed with a different amount, or completed after a role change.

## Do not report (in addition to the shared rules)

- A dishonest Aztec node, PXE or RPC, unless the fix is one line. The owner accepts that an
  honest node is assumed.
- A loss a caller inflicts on itself by bypassing the project's SDK (`packages/bridge-core`).
- Admin powers the design grants (pause, merchant listing, ownership transfer) without an
  unprivileged amplifier.
- Proving cost, gate counts, note-discovery performance, and style.

## Output

Use the shared-rules format unchanged. `contract:` is the Noir contract (`Token`, `TokenBridge`,
`TokenMinterProxy`) or the library crate (`claim_secret`, `merchant_stamp`, `portal_messages`,
`hints`). `function:` is the Noir fn name exactly as written. A privacy-leak FINDING's `proof:`
names the published datum (enqueued call and its arguments, public storage write, log, nullifier)
and the party it reveals.
