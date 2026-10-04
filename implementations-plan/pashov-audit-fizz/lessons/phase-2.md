# Phase 2: portal guards (2026-10-05)

| Attempt | Result | Consequence |
|---|---|---|
| `_requireNonZero`, `_requireCanonical`, `_requireDepositor`, explicit public refund address | Guard order as planned: nonzero → cap → recipient → depositor → canonical, all before any sha256. | `withdraw` untouched; `test_staleRollup_refusesDepositsButStillPays` pins that an exit pays after a canonical switch. |
| `proveRejectsBadRefund` picking the refused address from a `[0, portal, router]` memory array | halmos 0.3.3: `[ERROR] … NotConcreteError: symbolic memory offset` (it cannot index memory by a symbolic value). | A nested conditional selects the address instead; 14/14 proofs pass. |
| Slither gate | `slither: command not found`: this host had no Slither (CI installs it). `python3 -m venv` fails without `ensurepip`. | Installed 0.11.6 from the repo's hash lock: `python3 -m venv --without-pip <dir>` + `python3 -m pip --python <dir>/bin/python install --require-hashes --no-deps --only-binary :all: -r slither-0.11.6.requirements.txt`, linked into `~/.local/bin`. 0 results. |
| Fizz zero-amount handler | Flipped: both direct legs now expect `ZeroAmount` (selector-exact) as a no-op; SP-22 asserts no message on any path. | PROPERTIES.md SP-22 updated. |
| Fizz public deposits | Name the acting actor as the refund address. A fuzzed third-party refund address is P5's (new properties). | |

Gate: `bun run lint` 0, `bun run typecheck` 0, `bun run test` 0 (Node 24 on PATH), `bun run test:evm` 94 passed, `bun run test:evm:formal` 14/14 + self-test, `bun run test:evm:slither` 0 results.
