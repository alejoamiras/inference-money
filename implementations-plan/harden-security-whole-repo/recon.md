# Recon: expiring, pay-once stamps

Read on `9f84cdb` plus arc 1 (2026-10-02). One reuse sweep (Sonnet explorer), then the driver's own read of the token, the hints, upstream completion and the PXE's expiry rounding. Noir dependencies were read in the nargo cache (`~/nargo/github.com/<owner>/<repo>/<tag>`).

## Reuse map

| Capability | What exists | Verdict |
|---|---|---|
| A timestamp in a private function | `context.get_anchor_block_header().timestamp()`; today only inside the unconstrained probe (`contracts/aztec/token/src/hints.nr:97-111`) and `MerchantList.anchor` (`main.nr:1146`). No constrained token code compares a timestamp. | adapt: the primitive exists, the comparison is new |
| Bounding a tx's validity | `PrivateContext::set_expiration_timestamp` (aztec-nr `private_context.nr:648`, takes the minimum). Reached today only through `DelayedPublicMutable` reads in `_assert_merchant` (`main.nr:1056-1062`). | reuse as-is |
| Time in a public function | `PublicContext::timestamp()` (aztec-nr `public_context.nr:592`); unused in the token. | reuse as-is |
| The stamp | `merchant_stamp::stamp/pad` (`contracts/aztec/merchant_stamp/src/lib.nr:25-31`), pushed at `main.nr:1127-1136`, proven at `main.nr:1094-1120` (private, settled at the anchor) and `:408-415` (public, at the tip). TS mirror `packages/bridge-core/src/stamp.ts`; pinned by the keystone (`contracts/aztec/keystone/src/main.nr:168-200`). | adapt: bind a time bucket into the stamp |
| The opening time of a stamp | Nothing stores it: a nullifier carries no timestamp, and opening is private. Search: `timestamp`, `expiration`, `include_by` across `contracts/aztec/*/src`. | build new: the bucket goes into the nullifier's preimage |
| A single-use marker | Upstream's validity commitment, `cancel_authwit` (`main.nr:615-619`), `#[authorize_once]`, the bridge's `funding.initialize`. No marker derived from a request's commitment other than stamp and pad. Search: `push_nullifier`, `nullifier` across the five Aztec crates. | adapt: one more separated nullifier, the stamp/pad pattern |
| Client-side pay-once | `packages/bridge-core/src/payments.ts`: `PaymentGate`, `PaymentStore`, `completionCount`, `PaymentRefusedError`. | reuse as-is; the chain rule narrows the gap between clients that share no store |
| Reading a stamp from TS | `isStamped` (`payments.ts:123`): one `findLeavesIndexes("latest", …)` call. | adapt: send every candidate bucket in the same call |
| Refusal strings | `TOKEN_REFUSALS` (`packages/bridge-core/src/rules.ts`); `rules.test.ts` requires each verbatim in `main.nr`; matched exactly in `apps/showcase/src/live/actions.ts:283` and `outcome.ts`. | adapt: add the new strings |
| TXE time | `env.mine_block_at(ts)`, `env.last_block_timestamp()`, `utils::anchor_at` (`contracts/aztec/token/src/test/utils.nr:112-114`). | reuse as-is |
| Moving a local network's clock | No spec warps time (search: `warp`, `setNextBlockTimestamp`, `increaseTime`, `evm_` across `packages/integration`, `packages/local-network`, `apps/showcase/e2e`). The pinned node has `aztecDebug_warpL2TimeAtLeastBy`. | reuse the node's call; the harness gains one client |
| Expiry parity on a real network | `packages/integration/test/transfers.test.ts` [A21], `committedExpiry`. | reuse: add the payment case |

## What the code says

- **The expiry every tx commits.** The PXE returns `anchor + 86400` only when the in-circuit cap reaches it; otherwise it rounds the remaining lifetime down to whole hours, then half hours, then seconds (`@aztec-labs/pxe` `private_kernel/hints/compute_tx_expiration_timestamp`). An ordinary tx commits `anchor + 82800` (23 h): [A21] measures a transfer reading a 24 h entry (cap `anchor + 86399`) against a tx that reads nothing and finds them equal, and `docs/architecture.md` relies on it. Where the ordinary tx's own cap is set was not traced. A payment whose stamp cap is at least `anchor + 82800` commits the same.
- **A tx is includable while the block's timestamp is at most its expiration** (`@aztec-labs/p2p` `msg_validators/tx_validator/timestamp_validator`: rejected when `expirationTimestamp < timestamp`).
- **A local network's clock can be moved**: the node's debug API (`@aztec-labs/stdlib` `interfaces/aztec-node-debug`, namespace `aztecDebug`) has `warpL2TimeAtLeastBy`, served by the automine sequencer a local network runs. No spec uses it yet.
- **Private completion** (`complete_from_private`, aztec-nr `uint-note/src/uint_note.nr:218-243`) proves the validity commitment for `(commitment, completer)` settled, so only the designated completer can pay, and it does not refuse a zero value. Public completion (`complete`, `:189-214`) refuses zero.
- **The side hint** (`hints.nr:60-74`) prefers the stamp whenever it exists; a tx's capsule overrides it. A merchant payer is proven a merchant only when no stamp is found.
- **`mint_to_commitment`** (`main.nr:557`) is the minter's path and is not stamp-gated.

## Guards the change must keep green

- `contracts/aztec/scripts/abi-superset.test.ts`: exact sets of added functions, storage and events; every upstream function keeps its selector and signature; public bytecode ceiling `MAX_PUBLIC_BYTECODE_FIELDS = 2700`.
- `contracts/aztec/scripts/compile.sh --check`, and the pinned class ids in `packages/bridge-core/src/artifacts.test.ts`.
- The keystone's separator tests: a new separator joins `others: [u32; 75]` and gets its derived-and-pinned literal.
- `contracts/aztec/token/txe-manifest.txt` (153 names) and the floor in `run-txe-tests.sh`.
- `contracts/aztec/scripts/check-sole-consumer.sh` does not scan the token; nothing here touches what it scans.
- `packages/bridge-core/src/rules.test.ts`: each refusal string verbatim in `main.nr`; `tokenRefusalOf` matches longest first, so no new string may contain an existing one.

## Collisions and risks

1. An expiry stored next to the stamp needs a public write keyed by the commitment, which publishes the opening and breaks the stamp/pad parity ([A22] counts one nullifier either way). The bucket in the preimage avoids it.
2. Stamp and pad must stay one nullifier each at opening.
3. Both payment paths must push the same paid marker, or a private and a public payment into one request both land.
4. The private path's clock is the anchor, the public path's the block: the cap on the private tx's expiry is what bounds its inclusion.
5. `payment_side_hint` returns the stamp first even for a merchant payer; with an expired stamp it must fall through to the merchant proof.
6. A cap below `anchor + 82800` marks the payment tx. The cap is unavoidable (without it a stale anchor extends the stamp by a tx lifetime), so the SDK refuses to pay a request too old to pay unmarked.
7. The committed token artifact changes, so `instanceFromRecord` no longer derives `deployments/testnet.json`'s token (`packages/bridge-core/src/instances.ts:35`): a build from this code cannot use the testnet deployment until it is redeployed. CI does not check that pairing (`apps/showcase/build/manifest-identity.test.ts` compares manifests, not class ids), so the PR stays green while the merge needs the redeploy.
8. Tests that become false: `a_request_stamped_for_a_merchant_stays_payable_after_its_switch_off` (it anchors at `t0 + DAY`), and [A22]'s "a second payment into one request lands on chain" (`packages/integration/test/requests.test.ts`).
9. Sentences that become false: `docs/integration.md` (stamps "with no end date", "Paying a request twice loses the second payment"), `docs/architecture.md` (the request and expiry paragraphs), `docs/operations.md` (switch-off: "nothing revokes a stamp"), `docs/assurance-map.md` (A22), the headers of `merchant_stamp/src/lib.nr`, `stamp.ts` and `payments.ts`.
10. The recorded tours (`deployments/testnet-tour.json`, `apps/showcase/e2e/fixtures/tour.json`) record nullifier counts per step; a payment gains one. The testnet recording stays as recorded (no redeploy in this plan).

## Conventions to match

- Noir tests: `#[test] unconstrained fn`, `utils::setup_merchant_world(false)`, `#[test(should_fail_with = "<exact string>")]`, time through `utils::anchor_at`.
- A new cross-toolchain constant: literal in `merchant_stamp/src/lib.nr`, re-derived and pinned in the keystone, mirrored as a literal in `stamp.ts` with a vector in `stamp.test.ts`.
- Integration specs: `describe.skipIf(!INTEGRATION)`, tagged with their assurance row.
