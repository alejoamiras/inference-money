# Fable audit — usdc-bridge

## Round 1 — plan audit (Plan subagent, Fable 5.1)

Verdict: **conditional approve** (with conditions: (1) L2 contracts deployed deployer-bound, not universal, and `owner` read back on proxy + bridge; (2) a read-only testnet probe moved to Phase 1 plus an explicit L2 deploy-fee path; (3) `@aztec/ethereum` dropped from bridge-core and the bridge-core↔deployer devDependency cycle removed; (4) the privacy and Permit2 residual statements corrected before UI copy is written). Historical paths are nulo.

### High
- **H1 — L2 init front-run captures the bridge's pause authority silently.** V1 deployed with `universalDeploy: true` (`4df5eae5:packages/bridge-core/scripts/deploy-bridge-testnet.ts:236`, `script-l2.ts:30`); aztec-nr accepts any initializer when `deployer.is_zero()` (`v5.0.1:…/initialization_utils.nr:159-172`); proxy and bridge constructors write `owner = msg_sender`. A proxy front-run halts the deploy; a bridge front-run does not — the attacker silently owns `set_paused`. Fix: deployer-bound instances; read back proxy owner and bridge owner.
- **H2 — No fee path if the testnet SponsoredFPC is absent/drained.** V1 paid L2 deploys via `sponsoredFpcFee` (`deploy-bridge-testnet.ts:511`); nulo later called it absent on mainnet (`72fcfbf7`). Fix: state the fee path; keyless read-only probe in Phase 1 (node info, FPC instance + balance, registry→rollup→inbox/outbox).

### Medium
- **M1** — Private claims/exits publish the amount on L2 (`aztec-standards v5.0.1 main.nr:670-673, 447-453, 690-693`); bridge/proxy named in public phase. Privacy = recipient-only.
- **M2** — Permit2 residual misstated: unlimited `approve(PERMIT2)` makes a phished plain `PermitTransferFrom` naming an attacker spender a drain. Consider exact approval option.
- **M3** — `L1Port` is a hand-rolled viem; the only `@aztec/ethereum` use is `OutboxContract` as `OutboxRootsReader` (one `getRoots(epoch)` view). Re-implement over canonical viem; drop the seam.
- **M4** — bridge-core ↔ deployer devDependency cycle breaks `tsc -b`; move integration tests to their own package.
- **M5** — wagmi default `http()` transport leaks IP/address to a public RPC; use `unstable_connector(injected)`.
- **M6** — Exit leg is not "unrecoverable" (public inputs; `callerOnL1 = 0`); offer resume-from-L2-tx-hash (no persistence).
- **M7** — `PORTAL.underlying()` returns 0 on an uninitialized portal → router brick; require non-zero.

### Low
L1 keep `AztecAddress.isValid()` fail-closed; L2 `L2InstanceRecord` needs `initializer` + `publicKeys`; L3 SPDX Apache-2.0 headers; L4 choose permit deadline deliberately (≥ 30 min); L5 throwaway key holds the pause authority — decide; L6 key delivery via gitignored 0600 file, not shell env/argv; L7 future relayer needs recipients to `registerSender(relayer)` for note discovery; L8 Playwright shim doesn't announce EIP-6963 — target `window.ethereum`; L9 router invariant = per-call delta 0 (donations).

### Assumptions
Facts 2, 5–9, 11, 12, 14 verified; Fact 1 correct in plan, recon typo (`7bdbd8a2` → `6b07138b`). I4 promotable: `git diff v5.0.0 HEAD` on IOutbox/IInbox/IRollup/IRegistry/DataStructures/Hash/TokenPortal.sol is empty. I9 evidenced by the freeze test wallet; I3 verified for the test wallet only; I1/I2 unverified but provable read-only now. Asks: deployer-bound deploy, exact vs max approval, injected-only RPC, exit resume, pause-key retention, key delivery, SponsoredFPC as sole testnet fee path.

### A vs B
A. The proxy is the cycle-breaker; B moves the one-shot setter into the bridge (no authority saved) and forfeits TXE + red-team lineage. Keep pause; fix custody. Keep 4 arcs over B's 2. Spend B's simplicity instinct on M3.

### Phases & gates
Add the Phase 1 probe and a Phase 2 fork test against the real registry/Inbox; add a connect smoke before UI work; make the sponsored-payer assertion mandatory locally; `provenTimeoutSec ≥ 60 min`; testnet fees via SponsoredFPC.

### Looks right
F-001 guard verbatim; deploy order; immutable PORTAL/TOKEN, u128 cap, zero private recipient, exact pull, ownerless router; recipient-committed claims + sole-consumer + keystone; 7-arg withdraw; freeze harness reuse; porting from bridge-core; mined-log leaf index; PXE-anchor gating; supply-chain posture.
