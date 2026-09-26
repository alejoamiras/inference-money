#!/usr/bin/env bash
# Runs the symbolic suites and fails unless EXACTLY the expected proofs ran and passed. halmos prints one summary per
# contract and no grand total, so a deleted proof file or a renamed `check_` would otherwise vanish silently.
set -euo pipefail
cd "$(dirname "$0")/.."

EXPECTED_CONTRACTS=(
  "3 FormalPortalTest"
  "5 FormalRouterTest"
)
EXPECTED_PROOFS=(
  check_initializedBindingsCannotChange
  check_initialize_rejectsNonInitializer
  check_deposit_rejectsAmountAboveU128
  check_deposit_conservesUserFunds
  check_deposit_rejectsZeroAmount
  check_deposit_privateRequiresZeroRecipient
  check_deposit_publicRequiresRecipient
)

log=$(mktemp)
trap 'rm -f "$log"' EXIT

# halmos reads the solc AST from the artifacts; without it halmos reports "No tests" and exits 0.
forge build --ast --force >/dev/null
halmos --match-contract '^Formal' 2>&1 | tee "$log"
# halmos colors its output even into a pipe.
clean=$(sed -E 's/\x1b\[[0-9;]*m//g' "$log")

fail=0
for entry in "${EXPECTED_CONTRACTS[@]}"; do
  read -r n contract <<<"$entry"
  grep -qE "^Running ${n} tests for .*:${contract}\$" <<<"$clean" || {
    echo "halmos-gate: expected ${n} proofs in ${contract}" >&2
    fail=1
  }
done
for proof in "${EXPECTED_PROOFS[@]}"; do
  grep -qE "^\[PASS\] ${proof}\(" <<<"$clean" || {
    echo "halmos-gate: ${proof} did not pass (missing, renamed or failed)" >&2
    fail=1
  }
done
summaries=$(grep -c '^Symbolic test result: ' <<<"$clean" || true)
if [ "$summaries" -ne "${#EXPECTED_CONTRACTS[@]}" ]; then
  echo "halmos-gate: expected ${#EXPECTED_CONTRACTS[@]} proof contracts, saw ${summaries}" >&2
  fail=1
fi
if grep -qE '^Symbolic test result: [0-9]+ passed; [1-9]' <<<"$clean"; then
  echo "halmos-gate: a symbolic proof failed or errored" >&2
  fail=1
fi
exit "$fail"
