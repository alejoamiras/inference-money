# Phase 15 — Fix the accepted findings

Status: **done** 2026-10-02. C-001 and the two exit lock-ups the arc-6 review found are fixed, gated and redeployed to testnet. The arc-6 loop and the final cross-arc pass both converged.

## C-001: the portal refuses a public recipient above the field

`TokenPortal._depositPublic` runs `_requireRecipient(_to)` right after the amount cap, before any hashing or pull: `uint256(_to) > Constants.MAX_FIELD_VALUE` reverts `RecipientExceedsFieldMax`. `Constants` comes from the same pinned Aztec artifacts the portal already imports `Hash` from. The order is forced: the u128 proofs take a symbolic recipient and expect exactly the cap error, and halmos 0.3.3 cannot model the sha256 that follows.

Tests:
- halmos `check_depositPublic_rejectsOutOfFieldRecipient` covers the direct and the routed entry point. Its mutant `PortalWithoutRecipientCheck` and the forge canary require the proof to fail on its own assertion, and the gate's expected set is now 11 proofs. A boundary canary deposits to `MAX_FIELD_VALUE` itself.
- Unit: `test_depositPublic_refusesARecipientAboveTheField` covers direct, `…For` and the boundary. `test_portalRefusesARecipientAboveTheField` checks that through the real router the revert unwinds the pull.
- `PortalRoundtripFuzz` and both invariant suites (`fail_on_revert = true`) fuzzed an unbounded recipient into public deposits; they now bound it to the field. The router invariant's `depositRaw` still sends anything, inside a `try`.
- Gas: a routed public deposit costs 856 more gas (596,706); the snapshot is regenerated.
- bridge-core's hand-written portal ABI gains the error (pinned to the compiled contract).

## Redeploy chain

1. **Old tickets.** The CLI holds none: the demo and smoke state for the old bridge (`0x0c179967…1924`, from `a95839e`) are empty. Left on the old deployment, all demo funds:
   - each P13 run's 0.01 USDC deposit from A_demo, whose claim data died with the test browser;
   - the old cast's Aztec balances: alice 10.02, bob 2, galactica 6.98 private and 10 public. Exits with the old cast's public keys can recover them.
2. **Funding.** A fresh cast needs 50 USDC on Ethereum (`DEMO_L1_TARGET`: A_demo 40, B_demo 10), sent by `demo fund` in the deploy run. The old cast's L1 float went back to the deployer with its public demo keys: A_demo 12.98 (`0xd146e85a…ac63c`) and B_demo 8.00 (`0x72ac9467…a112`). That left the deployer at 42.68 USDC, short 7.32.

## Gate

First run on `918ab66` (the fix and its docs): six of the eight lines green, two failures, neither in the fix:
1. `compile.sh --check` found no `aztec-nargo` at the default `~/.aztec/versions/<noir>/bin`, which this host never installed. The gate runs with `NARGO` at the pinned nargo, as every earlier gate here did.
2. `test:integration`, 41 of 42: the operator spec's "tour recorded on another deployment" wrote a one-step tour. The tour schema has required the whole acceptance run, in order, since P11, so verify rejected the schema before reaching the identity the test asserts on. Arc 5 never ran this suite. The spec now writes a whole, well-formed run whose only fault is the bridge's identity.

Rerun of lines 2 and 6 on `eadb1d3`: both green (integration 42 of 42).

## The exits' mirror of C-001 (arc-6 review, round 1)

Codex's arc-6 boundary review found the reverse direction of C-001, missed by both audit legs. Both issues predate this plan's hardening arc, and the owner chose to fix them and redeploy.
- **Address width.** An ABI-decoded `EthAddress` holds any field: the type defers its 20-byte check to the kernel, and that check covers only the message's outer portal address. A raw call could therefore pass a recipient or caller of 2^160 or more. The exit would burn the tokens into a withdraw message that Solidity's `address` arguments can never rebuild. `withdraw_content_hash` now refuses any address that does not fit 20 bytes, so every emitter (both exits and both returns) inherits the check. It is a messaged `lt` rather than `EthAddress::validate()`, whose bare range check gives a raw caller no reason. Keystone tests cover a wider recipient, a wider caller, and the widest address passing.
- **The portal as recipient.** The portal pays out only if its balance drops by exactly the amount, and a transfer to itself drops nothing. A merchant exit to the portal therefore burned the tokens into a message no withdraw could ever pay. bridge-core already refused this, but a direct call skipped bridge-core. Both exits now assert `recipient != config.portal` before the burn. The TXE tests cover the public exit and the private merchant exit.
- Not refused: a `caller_on_l1` that never calls `withdraw`, the portal included. That is the caller's own choice, the same as upstream, and a withdraw with a zero caller stays open to anyone.
- TokenBridge class id: `0x0115c9fc…e0e6`, from `0x29d62ee5…2d2b`. The TXE floors are now 74 (bridge) and 19 (keystone).

## Redeploy #1, superseded

Deploy (`bf31f5a0`) and admin accept (`1f2bdca1`) both exited 0 on `7b2f442`: portal `0x897A91CC…A332`, router `0x3a383bDc…E0a4`, bridge `0x115d7e1a…5d9c`. It was superseded before its demo was published, because the exit fixes change the bridge. Its demo setup was stopped after galactica's claim. The cast's L1 float went back to the deployer: A_demo 20 USDC (`0x64d8d874…0598`) and B_demo 8 (`0xeab27270…f805`). That leaves the deployer at 80.68 USDC. Left on it, all demo funds: the 22 USDC the stopped setup had deposited, 10 of them claimed by galactica publicly.

## Arc-6 review, round 2

The resumed Codex pass on `dd330b4` reported the code changes converged, high confidence, with no new material findings. The encoder covers both exits and both returns. The portal refusal sits before the message and the burn. The tests exercise the ABI-decoded wide address and need the exact refusal text. The deployment finding stays open until the second redeploy commits `testnet.json`, `testnet-demo.json` and `testnet-tour.json` together and `verify --tour` and the live check pass.

The full gate on `1b52e37` (the exit fixes) passed all eight lines: TXE 153/74/19, integration 42 of 42, the local deploy and strict verify, showcase components 64, e2e 7.

## Final cross-arc pass

Codex ran in a fresh session (`01a0fc15…`) over the net diff from `e1103f8`. The pass converged in round 4, one confirmation past the 3-round cap, under the owner's standing rule: keep going with minimal fixes. Its verdict: "Converged for `3ca86c3` (high confidence); no material findings."
- **Round 1:** seven Medium and two Low.
  - Fixed:
    - the showcase's journals could fall back to memory and still let the send go out;
    - a consumed deposit was announced as a mint;
    - bridge-core's public-recipient preflight had no production caller;
    - `verify` ignored a deploy key holding the guardian role;
    - `export` copied artifacts beside any manifest, without the promised checksums;
    - the showcase gate skipped its embedded tag and tour;
    - the exit refusals were missing from the catalog.
  - Argued, and withdrawn: the token's NatSpec, which is upstream's convention in a verbatim fork.
  - Argued and lost: the conflict retry. `refused` marked every rejection, a lost response included, and the testnet node sits behind a balanced URL.
- **Round 2:** the retry now decides a recorded send by its fate. A private deposit to an account bound to another funding address is refused before approval: the demo wallet holds the cast, so it can read the binding.
- **Round 3:** a checkpointed revert counted as gone, though a prune can undo it; it now waits for finality too.
- **After round 4, the e2e gate:** the finality-only retry broke the race the suite pins. Another visitor spends the note first, and the page must retry and settle, but it answered "may still take the first try". A send counts as gone at once only when the node refused it outright with `Invalid tx: …`: `sendTx` throws that before the pool, and an existing nullifier is one already in the chain's state. A lost response still waits for finality. Codex confirmed: "Converged within the explicitly accepted demo-risk boundary (high confidence)."
- **Accepted residual, demo funds only:** an SDK HTTP retry after a lost response, with the earlier copy mined and the receipt read from a backend that hasn't seen the block, could still send twice. Moved to follow-ups for any non-demo use.

## Redeploy #2

The deploy (`deploy-2ebbd894`) and the admin accept (`admin-accept-bad7b837`) both exited 0 from `dc6b2ce`:
- portal `0x6148010F…41Dc`, router `0x6F3733F1…7125`, bridge `0x23d8cce5…f8ca`;
- `demo fund` sent A_demo 40 USDC and B_demo 10 USDC, with 0.01 ETH each, and bridged 1,000 FJ to the sponsor;
- the admin accepted both roles and listed the two demo merchants in one tx.

Then, keyless:
- `demo setup` (exit 0) published the users' tag once both bindings had finalized.
- `smoke --record` (exit 0, 24 minutes) settled every step and refused both cheats. Its withdraw paid out on L1 (`0xda74c9e0…2d41`).
- `verify --tour` passed every check on `60f8381`, which commits the tag and the tour next to the manifest. The L2 supply is 29 USDC, equal to the portal's balance.
- The live check against the Workers preview of `60f8381` passed 2 of 2: all four cheats were refused with nothing sent, galactica's refund was proven in the browser, and A_demo's deposit landed.

Arc 6, round 3 (Codex, resumed): "Converged — the deployment finding is closed (high confidence, taking the reported successful runs as evidence). No material findings." Codex couldn't reach the preview from its sandbox, so it took the live check from the run's record.
