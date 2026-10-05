# Phase 11: held exit and the stamp tripwire (2026-10-05)

| Attempt | Result | Consequence |
|---|---|---|
| `check-stamp-constraint.sh` beside `check-sole-consumer.sh` | Both need the same comment stripping, body extraction and depth reading, so the helpers moved into a sourced `noir-text.sh` (`depth_at` is new); the sole-consumer self-test still rejects its 48 mutants. | One text toolkit for both guards. |
| The first `assert_outside` mutant | Its regex matched `_prove_merchant_side`'s `if side == FIRST {` before the payment branch, so the mutant broke the wrong function and passed for the wrong reason. | Mutant regexes anchor on `fn _prove_payment_side` first; the substitution supports four capture groups. |
| Perl inside the self-test | Without a locale, perl printed warnings into the captured refusal text and the reason comparison failed. | `export LC_ALL=C` at the top of the script. |
| `bun run lint`'s shellcheck | It runs on `git ls-files`, so an untracked script is never checked. | Shellcheck new scripts directly before their first commit. |
| The held-exit clock spec | Listed at the 1 h setting, the merchant's switch-off caps its exit at the change − 1, under the standard 82 800 s. An exit sent at once lands with that expiry; one proven then held past the change is refused by the node (`refused`, no tx effect, balance and supply unchanged). | `[A5]` in the assurance map; the Emergency runbook's unpause step cites it. |

Gate: `bun run test:integration` exit 0 (45 specs, then 6 clock specs including both `[A5]` cases); `check-stamp-constraint.sh --self-test` (11 mutants) and the check exit 0; `bun run lint:actions` exit 0; `bun run lint`, `typecheck`, `test` exit 0.
