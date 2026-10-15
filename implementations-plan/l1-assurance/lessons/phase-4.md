# Phase 4 lessons: the PR Medusa job and the nightly fork suite

## Fork suite through PublicNode

| Attempt | Result | Why |
|---|---|---|
| PublicNode, fork at the head | failed in `setUp` after 6 s: `failed to get account … block not found: 0xb5e52b` | `createSelectFork(rpc)` took the head from one backend; the next read hit a backend that did not have that block yet (a head read straight afterwards returned `0xb5e52c`) |
| `https://1rpc.io/sepolia` (diagnosis only) | failed at `createSelectFork`: `cu limit exceeded; Request too fast per second` | a keyless rate limit; tells nothing about the suite |
| Director's call (QUESTION → A) | `vm.rollFork(block.number - 8)` right after `createSelectFork`, test code only | 8 blocks is well inside a full node's recent-state window, and every backend has it |
| PublicNode, rolled back 8 blocks, three runs | 12/12 each, 9 s, 3 s and 2 s of wall clock (the suite itself 1.3 s, 1.3 s, 0.2 s) | — |

Lesson: a load-balanced public RPC is a set of nodes with their own heads, so a fork at `latest` races them. Fork a few blocks back.

## Workflows

- `bun run lint:actions` passes on `contracts.yml`, `_contracts.yml`, `fuzz-contracts.yml` and the new `fork-contracts.yml`.
- `fork-contracts.yml` cannot be dispatched before it is on the default branch (F8); the default branch is `dev`, so its first run is the nightly after this PR merges, or a dispatch then.
- The PR's `medusa` job measures I3 on its first run (this PR touches `contracts/evm/**`).
