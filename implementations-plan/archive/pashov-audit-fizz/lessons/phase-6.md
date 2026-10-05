# Phase 6: L1 docs (2026-10-05)

| Attempt | Result | Consequence |
|---|---|---|
| `docs/architecture.md` | Deposits name a signed key holder (router: the caller's key; portal: `FundingAuthorization`), the refund address, the canonical-rollup refusal, why the router and not the portal checks the Permit2 signature, and "What no contract closes". | The P7 audit's leads added two residuals there: an unbound account cannot bind after a rollup switch, and a key holder Circle already blocks can be named on the signed path (the submitter pays). |
| `docs/integration.md` | Typed errors (`KeyHolderRequiredError`, the portal and router errors, Permit2's two), the depositor by path, the per-deposit u128 cap, and "Depositing without the router" with its prerequisites. | The audit corrected the 7702 sentence: only a delegate that accepts the raw key signature passes the router's private leg; an ERC-7739 delegate fails it either way. Smart-contract wallets: the owner named as depositor holds the deposit outside the wallet's threshold. No cancel: sign a short deadline. |
| `docs/assurance-map.md` | Two Solidity names had gone stale in P3 (`test_deposit{Public,Private}_namesTheCaller`). A scratch check (`grep` every cited `test_`/`check_`/`invariant_` name against `contracts/evm/test`) found them; brace-expanded names are its only false positives. | A1, A2, A8, A9, A26 updated; A30 added for the signed path, cited by the `[A30]` integration spec. |
| `implementations-plan/follow-ups.md` | "An SDK flow for the portal's signed path" under Before mainnet. | — |

Gate: `bun run lint` exit 0.
