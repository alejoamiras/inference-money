# Follow-ups

Open work lifted out of closed plans, one line each with a pointer; delete a line once it resolves.

## Testnet

- Replace the temporary dRPC node URL (`packages/deployer/src/networks.ts`, carried into `deployments/testnet.json` and the testnet bundle's CSP) with a keyless public node once one serves rollup `2914217885`. [D29](archive/usdc-bridge/plan.md#decision-ledger)
- A poisoned demo binding is fixed only by rotation (`demo setup --rotate`): a new users' tag, a new cast and fresh demo funds. [plan](galactica-compliant-usdc/plan.md#key-interfaces-storage-message-formats)
- The showcase's conflict retry trusts the node's outright refusal. An SDK retry after a lost response, read from a lagging backend, could still send twice: fine for demo funds, not for real ones. [phase-15](galactica-compliant-usdc/lessons/phase-15.md)

## Before mainnet

- Admin custody: the bridge owner and the merchant admin are one key on testnet. Production uses Galactica's multisig, which has no tooling here yet. [plan: Assumptions](galactica-compliant-usdc/plan.md#assumptions)
- Merchant adds are instant by decision. Galactica can route them through its multisig's review, or the token can delay them, at the cost of onboarding taking the delay. [plan: Assumptions](galactica-compliant-usdc/plan.md#assumptions)
- A delayed admin handover the guardian can cancel (Ask 11): today an accepted handover moves both roles at once. [plan: Assumptions](galactica-compliant-usdc/plan.md#assumptions)
- A rollup-upgrade story: `TokenPortal.initialize` binds the canonical rollup, so a rollup switch strands the portal (testnet's switched on 2026-09-28). [plan: Security](archive/usdc-bridge/plan.md#security--adversarial-considerations), [phase-7](archive/usdc-bridge/lessons/phase-7.md)
- A mainnet fee path and sponsor strategy: mainnet has no SponsoredFPC, and the public sponsor pays every private claim and exit on testnet. [plan: Security](galactica-compliant-usdc/plan.md#security--adversarial-considerations)
- A relayer, if wanted: each recipient must `registerSender(relayer)` for note discovery. [plan: Security](archive/usdc-bridge/plan.md#security--adversarial-considerations)
- An external audit of the final contracts. `/harden security` (P14) ran before the P15 fixes; its finding and the two the arc-6 review found are fixed. [Arc 6](galactica-compliant-usdc/plan.md#arc-6-hardening)
- Revisit the unlimited USDC approval to Permit2 (`ensurePermit2Allowance`) against EIP-2612 exact permits. [D7](archive/usdc-bridge/plan.md#decision-ledger)
