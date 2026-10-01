# Phase 5 — L2 and TS mirror the depositor

Status: **green 2026-10-01.**

## Gate evidence

- `noir-deps.sh --self-test`, a clean-cache resolve and `--verify`; `compile.sh --check`: token `0x0a1c52d7…87a5` and proxy `0x0d218cb0…d2e6` unchanged, bridge re-pinned to `0x25df25bc…e9b2`.
- `bun run test:noir`: token 153, token_bridge 50 (the new `claim_{public,private}_wrong_depositor_rejected` among them), keystone 14 (the three vectors on `portal_messages` and `fuzz_deposit_hashes_bind_the_depositor`).
- `check-sole-consumer.sh --self-test` (15 mutants) and the check, on the new hash shapes with `portal_messages` in the scanned sources.
- `bun run test:evm` (70 tests, 13 suites), `bun run lint`, `bun run typecheck`.
- `bun run test`: bridge-core 144, deployer 30, local-network 14, web 93 (+1 skipped), contracts 2 + 6.
- `bun run test:integration`: 24 of 24, including `[A26] a router deposit names its signer, and a claim naming another depositor consumes nothing`.
- `RUN_ID=p5`: `deploy:local` then `verify:local` exit 0, with `portal.router` pinned and the router deployed before `initialize`.
- `bun run test:e2e`: 18 of 18.

## Findings

1. **`run-txe-tests.sh` reported passing tests as missing.** The manifest check piped `sed` into `grep -q` under `pipefail`: `grep` exits at its first match, and once the log outgrows the pipe buffer `sed` is still writing, dies of SIGPIPE, and fails the pipeline although the test passed. Fixed by stripping colours once into a variable and grepping a here-string (bb1aa28).
2. **The upstream `token_portal_content_hash_lib` cannot take a depositor.** The bridge now hashes through the local `portal_messages` lib, so the lib's `aztec-node` row left `noir-deps.sh`: a clean-cache resolve fetches six entries.
3. **Selectors are derived at compile time** (`comptime` keccak256 over the signature string) rather than pinned as literals, so a signature edit moves the selector in Noir exactly as it does in Solidity. The three keystone vectors and `ContentHash.t.sol` assert the same literals; `content-hash.test.ts` asserts them in TS.
4. **The deposit ticket takes its depositor from the router's `Deposit` event**, in both the receipt path and the log-scan recovery path; `claim` passes it as the claim's last argument. A direct portal deposit is not recoverable through the router helpers (they need the router event), which is the supported path.
5. **Codex, arc 2 round 1** (GPT-6 Astra, high): no exploitable regression. One low finding: every cross-toolchain vector and the keystone fuzz used low bits only, so an encoder that truncated addresses to 128 bits would pass, and the portal roundtrip fuzz capped amounts at 10^12 while claiming the whole domain. Adopted: high-bit vectors (depositor `0x8000…0001`, amounts 2^127 and 2^128 − 1) in all three toolchains, a keystone fuzz flipping every one of the 160 depositor bits, and the roundtrip fuzz over the full u128 range.
