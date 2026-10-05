# Follow-ups

Open work lifted out of closed plans, one line each with a pointer; delete a line once it resolves.

## Testnet

- Redeploy testnet with the expiring, pay-once token and the audit fixes' contracts, then record the demo again. The fixes bring new TokenBridge and Token class ids (events), and new portal and router bytecode (events, the transient guard). `deployments/testnet.json` names the old class ids, which the current artifacts no longer derive, so production's live mode cannot use that deployment until then. [plan](archive/harden-security-whole-repo/plan.md#arc-2-expiring-pay-once-stamps), [audit fixes](archive/tob-contracts-audit/plan.md#outcome)
- Replace the temporary dRPC node URL (`packages/deployer/src/networks.ts`, carried into `deployments/testnet.json` and the testnet bundle's CSP) with a keyless public node once one serves rollup `2914217885`. [D29](archive/usdc-bridge/plan.md#decision-ledger)
- A poisoned demo binding is fixed only by rotation (`demo setup --rotate`): a new users' tag, a new cast and fresh demo funds. [plan](archive/galactica-compliant-usdc/plan.md#key-interfaces-storage-message-formats)
- The showcase's conflict retry trusts the node's outright refusal. An SDK retry after a lost response, read from a lagging backend, could still send twice: fine for demo funds, not for real ones. [phase-15](archive/galactica-compliant-usdc/lessons/phase-15.md)

## Showcase

- `tryLock` (`packages/local-network/src/registry.ts`) reads the lock's holder, then checks it is alive: a holder that released the lock and exited in between is reported dead (two e2e runs starting together). Re-read the lock before throwing. [phase-4](archive/presto-showcase/lessons/phase-4.md)
- Presto's SDK reads `setForceLocal` only as a proof starts, so a proof under way when the consent stops still goes to Presto; a cancellation in the SDK would close it. [plan](archive/presto-showcase/plan.md#implementation-audit)
- The page opens on "Try it yourself", and a first visit shows only the header until the lazy chunk carrying the Aztec SDK arrives (35–40 s cold on 2026-10-02, about 1 s cached): a skeleton of the live page, rendered before the SDK, would cover the wait (`apps/showcase/src/App.tsx`, its `Suspense` fallback).

## Before mainnet

- Admin custody: the bridge owner and the merchant admin are one key on testnet. Production uses Galactica's multisig, which has no tooling here yet. [plan: Assumptions](archive/galactica-compliant-usdc/plan.md#assumptions)
- Merchant adds are instant by decision. Galactica can route them through its multisig's review, or the token can delay them, at the cost of onboarding taking the delay. [plan: Assumptions](archive/galactica-compliant-usdc/plan.md#assumptions)
- A delayed admin handover the guardian can cancel (Ask 11): today an accepted handover moves both roles at once. [plan: Assumptions](archive/galactica-compliant-usdc/plan.md#assumptions)
- A rollup-upgrade story: `TokenPortal.initialize` binds the canonical rollup, so a rollup switch strands the portal (testnet's switched on 2026-09-28). [plan: Security](archive/usdc-bridge/plan.md#security--adversarial-considerations), [phase-7](archive/usdc-bridge/lessons/phase-7.md)
- A mainnet fee path and sponsor strategy: mainnet has no SponsoredFPC, and the public sponsor pays every private claim and exit on testnet. [plan: Security](archive/galactica-compliant-usdc/plan.md#security--adversarial-considerations)
- A relayer, if wanted: each recipient must `registerSender(relayer)` for note discovery. [plan: Security](archive/usdc-bridge/plan.md#security--adversarial-considerations)
- An external audit of the final contracts. `/harden security` (P14) ran before the P15 fixes; its finding and the two the arc-6 review found are fixed. [Arc 6](archive/galactica-compliant-usdc/plan.md#arc-6-hardening)
- An SDK flow for the portal's signed path (smart-contract wallets, 7702 wallets without ERC-1271): today it is documented in `docs/integration.md` with typed data in bridge-core, and integrators build the submit themselves (owner, 2026-10-04).
- Revisit the unlimited USDC approval to Permit2 (`ensurePermit2Allowance`) against EIP-2612 exact permits. [D7](archive/usdc-bridge/plan.md#decision-ledger)
