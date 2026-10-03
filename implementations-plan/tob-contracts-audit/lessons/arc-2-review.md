# Arc 2 review: Codex fix loop

Codex GPT-6 Astra, high, read-only, over `git diff 40c82a1..HEAD`, with the arc map, the adversarial ask and both rules (smallest fix, comment value per character).

**Prompt drift, caught before round 2's answer:** the arc 1 prompts and arc 2's first one carried the adversarial ask without its last sentence ("Where are the supply-chain, crypto or least-privilege weaknesses?"), and the first round-2 resume paraphrased the two rules. Round 2 was stopped and resent with all three verbatim; the cross-arc pass asks the full question over `be70fec..HEAD`, arc 1 included.

## Round 1 (session `01a10369`)

`MATERIAL FINDINGS: 1`

| Severity | Finding | Verdict |
|---|---|---|
| Medium | `slither.config.json`'s `filter_paths: node_modules` drops any result with one element under `node_modules`, so a `src/` finding through SafeERC20 would vanish | adopted. Confirmed in Slither 0.11.6's `valid_result`: `any(re.search(path, …))` over the elements, though its docstring says "all". Filter removed; `exclude_dependencies` still drops dependency-only results. That surfaced `pragma` (the npm dependencies' differing ranges, unfixable here): the owner chose to exclude it. Slither: `0 result(s) found`, exit 0 |
| Nit | `Withdraw`'s notice: "never the tx sender" overstates (with a caller, it is `msg.sender`) | adopted: reworded |
| Nit | A28: "every admin change emits one event" is too broad (`add_merchant` emits two) | adopted: scoped to the roles, the pause and the delay setting |
| Nit | `tokenEvent`'s doc comment and the token's event-group comment narrate | adopted: both deleted |

Fixes in a329d19; the fix gate (static guard, lint, `lint:actions`, `test:evm`, `test:evm:gas`, `test:evm:slither`, `compile.sh --check`, `test:noir`, `bun run test`, typecheck) exit 0 at every step.

## Round 2 (same session, verbatim rules)

"All four fixes verified. No new merge-blocking findings; the rebuilt token artifact differs only in debug metadata. Confidence: high." `MATERIAL FINDINGS: 0`. **Converged.**

| Severity | Finding | Verdict |
|---|---|---|
| Nit | plan.md's quality bar says deleting any emit "fails CI", but the L2 assertions run in the local integration gate (`integration.yml` lints and typechecks only) | adopted: the bar says which gate catches which |
