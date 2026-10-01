# Phase 3 — token wiring, integration, docs

Status: **in progress.**

## Findings

1. **I2 was wrong: the proxy's and the bridge's class ids change** when their `token` dependency points at the fork (proxy `0x18d06d3b…af94` → `0x0d218cb0…d2e6`, bridge `0x2e9ade2e…96a3` → `0x2b818998…3d34`). Their bytecode and functions are identical. The only difference is `outputs.globals.storage`: Noir copies every contract crate's storage layout into the artifact of each crate that depends on it, so the fork's six new slots appear in both, and the artifact hash, which covers `outputs`, moves the class id. Nothing deployed depends on the old ids, since P9 redeploys all three, so the fix is to re-pin them in `artifacts.test.ts`. Until P9, `deployments/testnet.json` is the old deployment: its records no longer derive from the artifacts, so a testnet build from this branch fails at registration. `main` is unaffected.
