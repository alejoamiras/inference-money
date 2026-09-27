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
Run 10c: 17/17 passed; teardown clean.
Run 10d (the CI node tree via `AZTEC_NODE_HOME`, confirmed from the node's process paths): 17/17 passed; teardown clean.

## Arc 3 codex loop

### Round 1 — session `01a0e05c-65ea-70a1-9ffd-9c48784ab4ad` (GPT-6 Astra, high), on `2c90344`

Three High, four Medium and one Low finding, each verified against the code before acting; codex reproduced most of them in memory.

| # | Sev | Finding | Verdict and fix |
|---|---|---|---|
| F1 | H | `claim()` returned as soon as the wallet did. `EmbeddedWallet.sendTx` defaults to `TxStatus.PROPOSED`, and a proposed block can be dropped, so the flow discarded the draft and its secret too early. `already-consumed` read the nullifier at `latest`. | **Accepted.** Claims wait on `L2_DONE` (`CHECKPOINTED`, 600 s), and `isClaimConsumed` reads the nullifier tree at `checkpointed`. The unit tests pin both. The private-deposit e2e checks the node's own receipt: checkpointed or later, `success`. |
| F2 | H | `sendExit` exposed the hash only after the receipt wait, so a failure after broadcast lost it and the form came back fresh: a retry burns again. | **Accepted.** The exit is sent with `NO_WAIT`, and `waitForTx(node, hash, L2_DONE)` runs inside the same try, so every post-send failure is an `ExitUnconfirmedError` carrying the hash. In the app, a send error that may have come after the broadcast (transport or unrecognised, not a simulation failure) opens the unconfirmed state with no hash: the tab stays guarded, the copy points at the wallet's activity, and only a Close (after checking) or a finish leaves. |
| F3 | H | The parsed grant never gated anything: a wallet could withhold `claim_private` and the app still marked the contracts ready and took an L1 deposit. | **Accepted.** `requestCapabilities` refuses a grant that withholds any requested contract (`missingGrants`); a wildcard grants nothing. `[A16]` now asserts the refusal lands before any call: no denial recorded, no registration attempted. |
| F4 | M | A receipt timeout released the withdraw lock while the L1 tx could still mine, letting another tab submit again (no double pay, but wasted gas). | **Accepted.** `withdrawOnL1` keeps waiting while L1 still has the tx and fails only once `getTransaction` reports it gone; any other read error counts as still known. The lock holds throughout. |
| F5 | M | Pending work was not bound to the reviewed account: switching accounts mid-deposit claimed from B for recipient A (a silent relayer path), and an exit read its account before holding the switch gate. | **Accepted.** Deposit and withdraw requests carry the reviewed account. The start refuses a changed account, a claim leaves only from the deposit's recipient (checked under the gate), and an exit reads, checks and sends under one gate hold. |
| F6 | M | The egress fence allowed every loopback port (other runs included) and could not see WebSockets or service-worker fetches. | **Accepted.** An exact-origin allowlist (the app, the wallet frames, the node), WebSockets refused and recorded, service workers blocked in the config, and a canary test proves the fence refuses another loopback port for both HTTP and WebSocket. |
| F7 | M | A labelled EVM-only PR skipped e2e through the path filter, and the status job accepted `skipped` either way. | **Accepted.** The e2e job depends on the label or dispatch alone: it deploys the contracts, so no path filter can call it irrelevant. When requested it must succeed; otherwise it must be skipped. |
| F8 | L | Both private-balance checks read the app's DOM, and `submitted()` records a tx before the node sees it. | **Accepted.** On top of the receipt check (F1), the sidecar's own wallet, which deployed every actor, reads the actor's private balance, so the app and the page's wallet take no part. The token-balance read moved into bridge-core (`l2UsdcBalance`), replacing the copies in the web app, the smoke and the integration actors. |

**Found in my own F2 fix before re-review.** `waitForTx` throws on a reverted receipt, and F2 wrapped every post-send failure in `ExitUnconfirmedError`. A reverted exit (a pause landing between the preflight and inclusion reverts the bridge's public check) discards its burn and withdraw message with the rest of its app logic, so the app would have held the user in "unconfirmed" with a hash that can never be finished and no Close. The wait now passes `dontThrowOnRevert`. A revert whose effect carries no withdraw message becomes `ExitRevertedError` ("nothing was burned"), and the form comes back. Anything else after the send stays unconfirmed. A unit row for a dropped tx was tried and removed: `waitForTx` ignores DROPPED receipts for a grace period, so the row only timed out, and "a checkpoint wait that fails" already covers that path.

**Validating round 1.**
- Unit: bridge-core 120, deployer 27, web 80 + 1 skipped. Lint, typecheck and actionlint are clean.
- Integration run 8 (`0beccc70-it-838707`): 16 pass, 0 fail, 63 expect(), 496 s, clean teardown. It ran on the round's first cut, before `ExitRevertedError` and `l2UsdcBalance`.
- Integration run 9 (`0beccc70-it-858330`, final code): 16 pass, 0 fail, 63 expect(), 500 s, clean teardown.
- Run 10e: 16 passed, 1 failed, 1 did not run (expiry waits on the bridge project); teardown clean.
  - The egress canary, the private deposit's node receipt check and `[A5]`'s NO_WAIT exit all passed live.
  - `[A16]` failed in the spec, not the app: the page showed "Your wallet declined the permissions…", but the spec still called `chooseAccountIfAsked`, which waits for a chooser that the refusal now prevents. The spec now asserts that the chooser never appears.
- Run 10f (final code): 18/18 passed in 10.0 min; teardown clean.
- Run 10g: 18/18 passed in 9.8 min; teardown clean. Two consecutive green runs on the round 1 code.
