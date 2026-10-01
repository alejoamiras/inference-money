# Phase 15 — Fix the accepted findings

Status: **in progress** 2026-10-01: C-001 fixed and tested; the gate matrix and the testnet redeploy chain follow.

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
