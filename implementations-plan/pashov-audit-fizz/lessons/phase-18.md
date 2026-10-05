# Phase 18: the keyed testnet redeploy (2026-10-05)

| Attempt | Result | Consequence |
|---|---|---|
| Keyed run 1 (`deploy-fund`): `probe` + `deploy testnet` + `demo fund` | Deploy and verify passed ("verified with the handover pending"). `demo fund` reverted on "ERC20: transfer amount exceeds balance": the L1 key held 30.68 USDC against the cast's 50.02. The exit scan failed too, `skipped=4`. | The owner topped the key up to 90.68 USDC. |
| The scan's `skipped=4` | A closed audit's Python venv under the cache root, whose `python` symlinks resolve to `/usr/bin`, outside the scan's roots. Removing dead node homes changed nothing. | The unreferenced venv moved out of `~/.cache/inference-money`; the scan then reported `skipped=0`. |
| `env-exec request` with the manifest copied back but uncommitted | Refused: "working tree not clean". | Each keyed run's manifest change is committed on the branch, then `keyed-worktree.sh sync`, before the next request. |
| Keyed run 2 (`admin-accept`) | Exit 0: the admin accepted the bridge and the merchant admin role; scan clean. | — |
| Keyed run 3 (`demo-fund`, rerun alone) | Exit 0: the cast's Ethereum accounts topped up, the sponsor's Fee Juice bridged; scan clean. | Two keyed runs never share the worktree at once: one's live wallet store would fail the other's exit scan. |
| Keyless `demo setup`, first pass | Deployed the cast, bound galactica and supplier to their treasuries with one-cent claims, waited for finality and read both bindings back, then stopped on "List the demo merchants first" (exit 1, by design). | — |
| Keyed run 4 (`merchants-add`) | Exit 0: both merchants listed in one tx; scan clean. | — |
| Keyless `demo setup`, second pass | Bound alice and bob, seeded the float, and published the users' tag about 50 minutes after the last claim: it waits for every claim to finalize, and testnet's epoch proofs set that pace. | Budget about an hour of finality wait per `demo setup` pass on testnet. |
| Keyless `smoke --record deployments/testnet-tour.json` | Passed in 24 minutes: deposit, claim, request, pay, refund, exit and withdraw settled; the non-merchant transfer and the foreign exit were refused. | — |
| `bridge verify deployments/testnet.json --tour deployments/testnet-tour.json` | Every check passed: class ids equal the artifacts, the admin holds both roles with nothing pending, no deploy key keeps a role, L2 supply equals the portal's USDC (32.02). | — |
| `SEPOLIA_RPC_URL=<public default> bun run test:evm:fork` | 12/12 against real Permit2, Circle USDC and the Aztec registry and Inbox. | — |
