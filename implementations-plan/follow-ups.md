# Follow-ups

Open work lifted out of closed plans, one line each with a pointer; delete a line once it resolves.

## Toolchain

- Once every Aztec `6.0.0-rc.1` package clears bun's 7-day gate (2026-09-30T20:10Z), drop the `minimumReleaseAgeExcludes` lists from the root, `contracts/aztec/toolchain` and `packages/local-network/toolchain` bunfigs and the AGENTS.md "Release-age gate" rule, then re-run `bun install --frozen-lockfile` in all three. [D27](archive/usdc-bridge/plan.md#decision-ledger), [phase-11](archive/usdc-bridge/lessons/phase-11.md)

## Testnet

- Replace the temporary dRPC node URL (`packages/deployer/src/networks.ts`, carried into `deployments/testnet.json` and the testnet bundle's CSP) with a keyless public node once one serves rollup `2914217885`. [D29](archive/usdc-bridge/plan.md#decision-ledger)

## Before mainnet

- Admin-key custody (multisig or timelock) for the bridge owner, which can pause claims and exits. [plan: Security](archive/usdc-bridge/plan.md#security--adversarial-considerations)
- A rollup-upgrade story: `TokenPortal.initialize` binds the canonical rollup, so a rollup switch strands the portal (testnet's switched on 2026-09-28). [plan: Security](archive/usdc-bridge/plan.md#security--adversarial-considerations), [phase-7](archive/usdc-bridge/lessons/phase-7.md)
- A mainnet fee path: mainnet has no SponsoredFPC. [plan: Security](archive/usdc-bridge/plan.md#security--adversarial-considerations)
- A relayer, if wanted: each recipient must `registerSender(relayer)` for note discovery. [plan: Security](archive/usdc-bridge/plan.md#security--adversarial-considerations)
- An external audit and a `/harden security` re-run on the final contracts. [plan: Security](archive/usdc-bridge/plan.md#security--adversarial-considerations)
- If the Permit2 deposit path survives the redesign, revisit unlimited Permit2 approval against EIP-2612 exact permits. [D7](archive/usdc-bridge/plan.md#decision-ledger)
