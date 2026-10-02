# Phase 4: the token's rule and its mirrors

Gate (2026-10-02), after the commits that carry the rebuilt artifact: `compile.sh --check`, `bun run test:noir` (token 163 functions with the manifest's names all passing, token_bridge 74, keystone 20), `check-sole-consumer.sh`, `bun run lint`, `bun run typecheck`, `bun run test`: all exit 0.

The token's class id moved to `0x2ce01e06458ad6ca41db9c0640fe015970fe253af97d1e8af75397a636e08b3e`; `deployments/testnet.json` still names the old one, which only a redeploy (the owner's) changes.

## What bit

- **The token's tests compile with the contract.** `compile.sh token` failed on the old stamp API in `src/test/` only; the contract itself type-checked. Update the tests before the first rebuild, or read the errors' paths.
- **TXE runs a public call at the last block's timestamp.** A user's public payment anchored at exactly the deadline found the stamp in the oldest live bucket, so the search's longest successful path is testable to the second in TXE.
- **The embedded wallet simulates before it sends, public calls included.** A public refusal (`already paid`) throws before anything reaches the node, so the integration specs can assert "nothing sent" for public paths too.
- **The payment test's fake chain needed real-shaped txs.** The gate's new check reads `tx.data.constants.anchorBlockHeader`; the fake payer now commits `anchor + lifetime`, standard unless a test marks it.
- **A stray Bash call of mine aimed outside the worktree** (an empty file under the main checkout's `.claude/`) was refused by the session's guard. Nothing needed it; nothing ran.

## Decisions

- `requestStamp` returns the stamp with its state (`fresh` or `live`) at the latest block, so `paymentSide` and the before-proving check read one value. `siloedRequestMarks` went: nothing used it once the stamp needed a bucket.
- `refuseStale` is one gate method used at both checks: under the store's lock it answers `stale` only to the reservation's owner, else what holds the request now.
- [A22]'s rewrite moved into this phase: its old second case asserted the double payment the token now refuses, and the workspace has to typecheck here.
