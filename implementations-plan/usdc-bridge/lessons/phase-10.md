# Phase 10 — Full e2e + testnet build

Status: **in progress.**

## What was built

- **Specs** (`apps/web/e2e/specs/`). Each carries its `docs/assurance-map.md` cell id.
  - `deposit`: public at 1024 px `[A1][A8]`, private at 390 px `[A2][A15]`.
    - The one signed permit's token, amount, spender, nonce and deadline equal the mined router calldata.
    - A private deposit's calldata names a zero recipient.
    - The claim's submitted fee payer is the SponsoredFPC.
    - The unload guard is up while the deposit is in flight.
  - `withdraw`:
    - public exit `[A4]`
    - private deposit + private exit, both sponsor-paid `[A5][A15]`
    - finish from (tx hash, recipient, amount) with no Aztec wallet `[A14]`; a wrong amount is "not found" first
    - two tabs finishing one exit `[A13]`: exactly one portal tx, and the second tab is told
  - `recovery`:
    - signature refusal `[A11]`
    - confirm-time read failure `[A12]`
    - swallowed deposit hash → re-check finds it by log and claims once `[A11]`
    - `CONTRACT_NOT_REGISTERED` → one re-register + retry, nothing shown `[A17]`
    - an ungranted registration → the wallet refuses and the app says why `[A16]`
  - `expiry` `[A11]`, its own Playwright project that runs last because it moves L1 time: a send the wallet never answers is only re-checked. Past the permit deadline it is proven not deposited, and discard leaves nothing in flight.
- **Sidecar** (`e2e/run/funder.ts`): Fee Juice for actors that pay public ops, a public USDC balance (deposit + claim), and a public exit for the finish/two-tab specs. It uses its own anvil key, and every L2 op is sponsored.
- **Assurance map**: TS unit / integration / e2e columns filled for A1–A10, and new cells A11–A18 for the SDK↔UI properties. Every integration title now carries its cell ids.
- **Testnet build identity**: `build:testnet` writes the exact manifest string it embedded (`dist/bridge-manifest.json`), then `build/manifest-identity.test.ts` asserts it equals the committed `deployments/testnet.json`. The same test checks that the bundle's code names that manifest's node, router, portal and bridge.
- **CI**: `_e2e.yml` (`workflow_call` + `workflow_dispatch`), called from `web.yml` on the `e2e` label. The node is provisioned by `packages/local-network/scripts/install-node.sh` through the new `aztec-node` input of `setup-toolchains`:
  - no aztec-up;
  - a frozen lockfile migrated from aztec-up's own npm lock;
  - Foundry 1.4.1, sha-pinned;
  - selected via `AZTEC_NODE_HOME`, which `resolveToolchain` now honours after checking that the install holds exactly `aztecNode`.

## App changes found by the specs

- **A send the wallet never answers left the deposit at `sending` forever.** "Look for it on Ethereum" now appears during `sending` once a submission is recorded. It supersedes the hung send by epoch: a late answer from the old send is ignored, and it never re-sends.
- **Finishing a withdrawal needed both wallets.** The finish form needs only the Ethereum account; a new exit still needs both.

## Attempts

1. **Confirm-read spec failed: the deposit went through.** The spec failed the first `getPredictedMinFees` with a 503. aztec.js's node client retries a 503, so the retry succeeded and the flow signed. Fix: fail every fee read. The client gives up, and the flow aborts before signing. The unit test had covered the app logic; only the harness assumption was wrong.
2. **`[A16]` failed on the denial record format.** The app behaved correctly: the wallet denied the registration, and the app showed "Your wallet declined the permissions…". The spec expected `denied()` entries to start with `registerContract`, but the test wallet records `registration of <address>` (`test-wallet/guard.ts`).
3. **CI node from a fresh resolve.** A fresh `bun install` of `@aztec/aztec@5.0.0` matched every `@aztec/*` version but resolved 230+ third-party deps newer than the aztec-up tree the local gate runs. Migrating aztec-up's `package-lock.json` into `bun.lock` gives the same resolution. What remains differs only in hoisting, plus other-platform binaries and the unused cli-wallet.
4. **CI node: blocked `bcrypto` build.** Bun blocked three lifecycle scripts. `bcrypto`'s is load-bearing: discv5 imports its native backend at node start, and without the build `require` throws. `trustedDependencies: ["bcrypto"]` runs only that one; `protobufjs` and `unrs-resolver` stay blocked.
5. **CI node proven locally.** From a clean `node_modules`: `install-node.sh` → `AZTEC_NODE_HOME=… net:up` (the node deployed its L1 with the pinned forge 1.4.1) → `deploy:local` verified every read-back → `net:down`. The Foundry tarball's sha256 equals GitHub's recorded asset digest, and its anvil/forge are byte-identical to aztec-up's.
6. **`[A5]` timed out waiting for the Aztec tx hash, though the withdrawal had finished.** The local network proves an epoch in seconds, so the flow reached `done` between Playwright polls, and `done` hid the hash. That hash is the one detail a user must keep to finish later, so it now stays on the done screen as a record ("Aztec transaction"), and the spec reads it after `done`. A component test covers the in-flight half, which a fast local network cannot show.
7. **`[A13]`'s second tab never became clickable.** Both tabs share one browser context, so wagmi reconnected the second tab from the first tab's stored connection: "Connecting…" (disabled), then detached. `connectL1` waited to click a button that could never be clicked. It now clicks only while the status reads `disconnected`, and retries until `connected`, which is also what a real user's second tab does.

8. **Expiry never reached its verdict.** `evm_increaseTime(31 min)` then a re-check still read "not found yet".
   - **Cause.** The local node warps L1 time on its own. Each L2 block sets the next L1 timestamp about 72 s ahead (`node:eth-cheat-codes Set L1 next block timestamp`), roughly 10× wall time. The head therefore runs far ahead of anvil's clock, and so does the permit deadline, counted from the later of head and wall clock. `evm_increaseTime` moves only anvil's clock offset, so the next blocks still took `last + 1` and never passed the deadline.
   - **Fix.** `mineL1Past(deadline)` sets the next timestamp from the head, past the signed permit's own deadline. It then checks that `finalized` got there, retrying if a node warp landed first.
   - **Side effect.** Locally, a 30-minute permit lasts about 3 wall minutes, so a wallet prompt left open that long expires the deposit. That is correct behaviour, but surprising in manual testing.

Run 10a (first full run): 12 passed, 4 failed (attempts 1, 2, 6, 7), expiry skipped behind them; teardown left no registry rows or processes.
Run 10b: 16 passed, 1 failed (attempt 8); teardown clean.
