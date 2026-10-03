# Arc 1 Codex fix loop

Codex (GPT-6 Astra, high), session `01a10332-8797-75f1-97c5-0addf80adca6`, over `be70fec..HEAD` with the arc map, the adversarial ask and both review rules.

## Round 1: MATERIAL FINDINGS: 2

| # | Sev | Finding | Verdict |
|---|---|---|---|
| 1 | Low | The payout regex matched any call ending in `message_portal(`: a no-op `not_message_portal(config.portal, content)` passed every check | accepted, verified: the need requires `self.context.message_portal(` with a non-identifier boundary, in both payout helpers; mutant `exit_lookalike_payout` |
| 2 | Low | "A fee on deposits makes them revert" is too broad: a fee charged to the depositor on top of a transfer still credits the portal exactly | accepted: the docs name which fees a deposit refuses |
| 3 | Nit | Counts read string literals: an assert message naming `message_portal` or `let config` would be rejected as code | accepted: counts and binding checks run on string-stripped code (`strip_strings`); no positive self-test added (no new mechanism) |

Fix commit `c76497c`. Self-test: 46 mutants rejected for their own reasons; real source upheld; lint exit 0.

## Round 2: MATERIAL FINDINGS: 2

| # | Sev | Finding | Verdict |
|---|---|---|---|
| 1 | Low | Round 1 stripped strings for counts only; `bound_to` and `need` still read them, so a quoted binding (`assert(true, "let content = withdraw_content_hash(…);")`) or a quoted config read satisfied the rules | accepted, verified (no rule's pattern needs string contents): `strip_comments` now empties string literals in the same pass, so every check sees code only and the per-helper stripping is gone; mutants `exit_quoted_hash`, `exit_quoted_config` |
| 2 | Low | "A fee charged to the depositor on top goes through" holds only for a direct deposit; a routed one reverts (`test_senderSurchargeCannotSpendDonations`) | accepted: the docs say so |

Fix commit `adebb61`. Self-test: 48 mutants rejected for their own reasons; real source upheld; lint exit 0.

## Round 3: MATERIAL FINDINGS: 0

> No new findings, including comments. Both round-2 findings are resolved. **Confidence: high within the stated tripwire scope.** Verified the normal guard, all 48 mutation cases replayed in memory, rejection of the quoted redirected payout, acceptance of diagnostic strings containing code-like text, and diff whitespace checks.

Converged.
