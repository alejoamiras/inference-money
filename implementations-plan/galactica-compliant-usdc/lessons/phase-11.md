# Phase 11 — UI, design F

Status: **done** 2026-10-01: lint, typecheck, `test:components` and `build:testnet` (P9's manifest, demo file and recorded tour) green on `5c98525`; P12's e2e drives live mode on a local network.

## Decisions

1. **Seven scenes from nine recorded steps.** "Pay a session" plays the request and the payment, "Withdraw home" the exit and the payout; each scene is four beats (ready, checking, moving, landed), the outcome held longest so its "why" can be read. A paused tour shows a chip's outcome at once; Replay plays a scene from its check.
2. **The tour shows net moves, not balances.** The recording carries amounts, not balances, so the tour's cards read "Moved in this tour" (`+7.00`); live mode reads the chains' balances.
3. **The tour loads no Aztec SDK.** The entry chunk was 10.8 MB, so the page would parse the SDK before playing anything. bridge-core exports `./rules` and `./types`, demo `./tour` and `./keys`; the wallet and live mode load by dynamic import. Entry: 217 kB (68 kB gzip). `build/bundle.test.ts` walks the entry's static imports and fails on any `@aztec-labs/` source among them.
4. **Real tx links on testnet only.** Sepolia's Etherscan and Aztecscan, whose tx page is `/tx-effects/<hash>` (route `routes/tx-effects/$hash` in its source; `testnet.aztecscan.xyz` is the explorer Aztec's testnet guide names). Pinned in `deployer/networks`; a local network links nothing. P13 checks that the recorded hashes resolve there.
5. **Fees read in fee juice**: 18 decimals, read from the testnet fee asset itself (`FeeJuicePortal.UNDERLYING()` → `decimals()` 18, symbol FEE).
6. **Every row says recorded or live**, and a live step the demo cannot afford (an empty Ethereum wallet, nothing to claim) replays the recorded one with that reason in the verdict, never silently.
7. **Refusals quote the contracts.** Transfers, requests and payments refuse in bridge-core's merchant-list pre-checks with the same strings `rules.test.ts` pins to the Noir source. ~~A user's exit is sent with `asMerchant`, skipping the SDK's own destination check.~~ **Wrong, found by P12's e2e:** `asMerchant` makes the contract prove merchant status, so every user exit was refused, her own funding address included. Only a merchant's exit sets it now; a user's exit elsewhere is refused by bridge-core's destination check (`ExitDestinationError`), which the page shows as `BRIDGE_REFUSALS.exitDestination`.
8. **The reset chip is `demo reset` from the page**: galactica refunds alice up to her seed, as far as its balance goes (`resetAmount`, shared with the CLI).
9. **The verdict's Prove stage comes from the PXE.** `EmbeddedWallet.create` builds `new this(…)`, so a subclass wraps the PXE it is given and reports `proveTx`; the node proxy reports send and settle. Both proxies bind methods to their target, since a class with private fields refuses a proxy as `this`.
10. **Payment records survive a reload**: `localStorage`, per deployment, written through an in-memory copy for when storage refuses a write, with Web Locks around each request's read-modify-write.
11. **The mode is in the URL** (`#live`), so a reload stays in live mode and resumes pending payouts; `#proving` is the harness's page.
12. **The demo flows moved to `packages/demo`** (deposit, claim, private send, the demo L1 signer, `recordingNode`, the deposit and payout world rows, the hidden-field lists): the deployer's smoke run and the page now share one copy.

## Findings

1. jsdom's `Storage` methods refuse a `this` that is not a real Storage, so a fake storage derived from `localStorage` by prototype fails its reads; tests build a plain object.
2. The node rejects a spent note as `Existing nullifier` and a tx spending one twice as `Duplicate nullifier in tx` (stdlib's `TX_ERROR_*`, 6.0.0-rc.1). The runner checks its own last send before retrying once.
