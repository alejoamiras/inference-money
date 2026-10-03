# Phase 4: L2 events (F-3, Aztec.nr)

## What changed

- Bridge: `PauseSet`, `OwnershipTransferStarted`, `OwnershipTransferCancelled`, `OwnershipTransferred`, declared after `Storage` and before every function (the static guard reads a body up to the next ` fn `); `cancel_ownership_transfer` reads the pending owner before clearing it, `claim_ownership` the previous owner before replacing it.
- Token: `MerchantAdminProposed`, `MerchantAdminAccepted` (previous admin read before the write), `MerchantGuardianScheduled` (`get_scheduled_value()`), `MerchantDelaySet` (with the guardian slot's delay change, `get_scheduled_delay()`); `ADDED_EVENTS` lists the four.
- `compile.sh` rebuilt token and bridge; the proxy's artifact did not move. New class ids: TokenBridge `0x2a55d66b…0efa`, Token `0x2006c78a…ecd4` (`deployments/testnet.json` keeps the old ones until the owner's keyed redeploy).
- bridge-core: `contractEvent(artifact, name)`; `tokenEvent` stays as its token wrapper. The deployer exports `guardianDelay` so the operator spec can compare `MerchantDelaySet` with storage.
- `operator.test.ts`: each admin change's event, every field, filtered by tx hash where the call returns a receipt and from the next block where a helper sends it (`proposeAdmin`, `acceptAdmin`). `MerchantGuardianScheduled.effective_at` is checked against `get_merchant_roles().scheduled_guardian_at`, `MerchantDelaySet.guardian_delay_effective_at` against the guardian slot's stored delay change.

## Kill proof

The integration spec is the proof for each emit: it reads the event back from the node, so deleting an emit or reading an overwritten value after the write fails it. TXE exposes no public logs, so no TXE test can.

## Notes

- **The local network needs a complete pinned node install, and a cached one can be an empty shell.** `test:integration` failed before any spec ran: `aztec 6.0.0-rc.1 toolchain is incomplete (missing …/node_modules/.bin/aztec …)`. `~/.aztec` holds no 6.0.0-rc.1, and every `~/.cache/inference-money/aztec-node-*` dir had a 4 KB `node_modules`: `install-node.sh` links them into the installing worktree's `packages/local-network/toolchain`, which dies with that worktree. Fix: `bash packages/local-network/scripts/install-node.sh ~/.cache/inference-money/aztec-node-tob` (frozen lock, Foundry digest checked) and `AZTEC_NODE_HOME` pointing at it.
- Earlier steps of the same gate passed on the first run: the static guard (self-test and real), lint, no drift under `contracts/aztec`, `compile.sh --check`, `test:noir`, `bun run test`, typecheck.
- **The handover spec's open-ended event query caught its own cleanup.** The second run passed 43 of 44: reading `MerchantAdminProposed` from a start block, after the `finally` had withdrawn the proposal, found the withdrawal's zero-address event too. The assertions now run inside `try`, before the withdrawal (4943dbf).

## Gate

Run with Phase 5 (one combined gate, sequenced so nothing reads an artifact `compile.sh` is rebuilding): static guard self-test and real, lint, `lint:actions`, `test:evm`, `test:evm:gas`, `test:evm:formal`, `test:evm:slither`, no drift under `contracts/aztec`, `compile.sh --check`, `test:noir`, `bun run test`, typecheck, `test:integration` (`44 pass, 0 fail`, then the clock specs `4 pass, 0 fail`): every step exit 0.
