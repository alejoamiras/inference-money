# Phase 16: the remaining leads, in docs (2026-10-05)

| Attempt | Result | Consequence |
|---|---|---|
| Finding where each lead belongs | Most leads were one line in the plan; the brief and the Noir ledger keys gave each its meaning. "A payer who opens a request writes its log, at both sites" means `initialize_transfer_commitment` and `transfer_private_to_public_with_commitment`, documented in `integration.md` and `architecture.md`. "The pad rule lives in the hint": stamp or pad follows the side proven, which the hint or a capsule picks. | Each lead went into the section its reader consults, with no new section. |
| F-03 by design | `operations.md` Emergency now says a switch-off demotes the account rather than freezing it, and names the stolen-key race to bind after the unpause. Merchants → Add says to list an account only after it binds its own treasury. The testnet runbook's order belongs to P15. | — |
| A7 | The row claimed "only the bridge mints or burns". Upstream's `burn_*` lets any holder burn its own tokens, and the bridge burns through the proxy under the holder's authwit. | The row cites upstream's own burn tests. |
| The "Claim a deposit" row | It is now split by role, as the rules-by-role convention asks, and names `allowBind` (P14). | — |

Gate: `bun run lint` exit 0.
