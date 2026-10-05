# Phase 10: the top-10 property tests (2026-10-05)

| Attempt | Result | Consequence |
|---|---|---|
| Drafted in the scratch repo while the Arc 2 campaign ran, then ported | All 17 new tests passed there first, then in the worktree. | — |
| SP-36 | The message helpers gain `_via` siblings that take the L1 sender; the four refusals (both claims, both returns) fail with the existing "message not found" errors, so the sender is the only difference from the passing tests. | — |
| GL-06 | `token/src/test/guards.nr`, one probe per `#[only_self]` helper, each by a different outsider (a user, a merchant, a stranger, the minter, the owner) and with arguments the body would accept. | A7's `guards` citation is now true for the token. |
| SP-26 | Three callers added beside the stranger: a merchant, the guardian once in office, the proposed admin before it accepts. | — |
| SP-50 | A TXE failed call ends the test, so "the victim can still exit afterwards" cannot follow a refused attempt. The tests have the stranger exit the same amount under the same nonce with its own authwit, show the victim's balance untouched, then exit the victim with its authwit, public and private. | The refusal half is the existing `exit_*_without_authwit_rejected`. |
| SP-02 | Every transfer kind, a request and its payment, two list calls and `cancel_authwit`, then the supply and every party's balances, the bystander's included. | — |
| SP-14 | A user naming a merchant completer for a request to a user is refused on creator and recipient. | — |
| SP-49 | Pinned as accepted behaviour (owner): a switched-off merchant that never bound binds late from any L1 address and exits there. | Onboarding (P15) binds before listing. |
| SP-07 | Already covered by `a_private_payment_of_zero_is_refused`. | Marked covered, no new test. |
| `contracts/aztec/PROPERTIES.md` | Each entry marked; findings 2, 3 and 5 fixed, finding 1 accepted; the summary is 32 covered, 7 uncovered (GL-13, GL-25, SP-39, SP-51, SP-52, SP-55, SP-59), 3 expected to fail. | — |

Gate: `bun run test:noir` exit 0 (token manifest 178 of 179 run, token_bridge 85, keystone 20; floors 178 and 85); `compile.sh --check` exit 0; `check-sole-consumer.sh --self-test` and the check exit 0; `bun run --cwd contracts/aztec test` 6 pass; `bun run lint` exit 0.
