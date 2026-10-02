# Phase 6 — Noir bridge rules

Status: **green 2026-10-01.**

## Gate evidence

- `compile.sh --check`: token `0x0a1c52d7…87a5` and proxy `0x0d218cb0…d2e6` unchanged; bridge re-pinned to `0x29d62ee5…2d2b`.
- `bun run test:noir`: token 153, token_bridge 72 (floor raised from 50: the binding, returns and exit-rule suites, rewritten claims), keystone 16.
- `check-sole-consumer.sh --self-test`: the real source upheld and 32 single-rule mutants (the 15 old ones and 17 new) each rejected for its own reason; then the check.
- `bun run --cwd contracts/evm build`, `bun run --cwd contracts/aztec test` (6), `bun run lint`, `bun run typecheck`.
- `bun run test`: bridge-core 148, deployer 30, local-network 14, web 93 (+1 skipped).
- Beyond the gate, because the deployer changed: `RUN_ID=p6` `deploy:local` then `verify:local` exit 0, with the bridge built from `(proxy, token, portal)` and `config.token` pinned at its new offset.

## Findings

1. **`TestEnvironment` is a value holding the account counters.** A helper that takes it by value and creates an account rewinds the caller's counter, so the next account the test creates has the same secret and address, and its deployment fails with "failed with duplicate nullifiers". `utils::merchant` takes `&mut TestEnvironment`.
2. **TXE deploys a crate's own contract from `target/`**, never from the source under test. After a contract change every test failed with "Unknown selector" until `compile.sh token_bridge` rebuilt the artifact.
3. **Pin the exact TXE failure text, never a fragment.** A second `PrivateImmutable` initialization fails in the tx's public phase with "Attempted to emit duplicate siloed nullifier", and reading an unbound one with "Failed to get a note". A bare `should_fail_with = "duplicate"` also matched the account collision of finding 1, a failure for the wrong reason. Both strings were read off a probe run before being pinned.
4. **Guard v2 substitutes the nth occurrence.** The claim and its return share signature lines, derive lines and consume shapes, so a mutant aimed at the return names which occurrence it replaces; a substitution that finds fewer occurrences fails the self-test.
5. **The claim's `bind` comes from `get_funding_address`, pulled forward from P7**, so every commit of this phase claims correctly for bound and unbound accounts. The read runs as the recipient (its own notes), and the app's grant scopes the utility. A private exit's `asMerchant` defaults to false, the user path.
6. `aztec compile` advises "Tests should be in a dedicated test crate, not in the contract crate" for token and token_bridge, as it did before this phase. Moving the TXE suites out of the contract crates is a restructure beyond this plan; noted, not acted on.
7. Between P6 and P7, integration and e2e are expected to fail: public claims to users, users' public exits, user exits to other addresses and relayed private claims are all refused now, and the specs still do them. This is the arc-level atomicity the plan accepts.
