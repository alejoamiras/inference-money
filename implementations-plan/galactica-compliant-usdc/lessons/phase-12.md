# Phase 12 — Local e2e

Status: **done**: 7 of 7 on a fresh local network (Playwright 2.5 min) and in CI (`_e2e.yml` run 36829954515 on the branch, 6 min end to end); `lint:actions` clean.

## Decisions

1. **Four specs, seven tests.** `tour`: it plays by itself, every scene shows its recorded outcome, every row says recorded, and it sends nothing. `try-cheat`: the four cheats, each refused while simulating with its rule verbatim, nothing on either chain. `try-happy`: deposit → claim → pay → refund → withdraw, the payout included, checked on anvil and on the node. `resilience`: the nullifier race, a reload mid-payout, the reset, and the two replay fallbacks.
2. **Sends are counted off the wire.** Each visitor's context records every JSON-RPC method it posts to the node and anvil (`fixtures/rpc.ts`), and can hold one request at the door. Holding is what makes the race (this page's send held while another visitor spends the same note) and the reload mid-payout deterministic.
3. **A visitor is a browser context**, with wallet stores of its own, as a second person on the page would be.
4. **The sidecar is only the block heartbeat.** Its funder and routes served the wallet-connect app's specs; nothing calls them now.
5. **A spec that expects a send counts it**, so a renamed method fails a spec instead of making "nothing was sent" pass.

## Findings

1. **Live withdrawals never worked.** The page sent every exit with `asMerchant`, which makes the contract prove merchant status, so a user's exit was refused even to her own funding address. Only merchants set it now; a user's exit elsewhere is refused by bridge-core's destination check before any witness or burn, shown as the contract's rule. P11's component tests fake the wallet layer, so only a real network could show it.
2. **aztec.js names the node's methods `aztec_*`** (`aztec_sendTx`). The node also answers `node_*`, which is why the suite's own receipt reads worked; the first run's "no sendTx" checks were vacuous until the specs counted the sends they expect.
3. **Local timings** (fake proofs): refusals 0.13–3.5 s, the exit's simulation the slow one; a deposit 0.1 s on automining anvil, a claim 11 s, a payment 9.5 s, a refund 4 s.
