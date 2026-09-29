#!/usr/bin/env bash
# Runs the symbolic suites and fails unless EXACTLY the expected (contract, proof) pairs ran and passed. halmos prints
# one summary per contract and no grand total, so a deleted proof file or a renamed `check_` would otherwise vanish
# silently; pairs rather than names, because the two contracts share `check_deposit_rejectsAmountAboveU128`.
#
#   halmos-gate.sh              build, run halmos, verify
#   halmos-gate.sh --self-test  verify synthetic logs: the expected set passes; a missing, swapped or failing proof fails
set -euo pipefail
cd "$(dirname "$0")/.."

EXPECTED=(
  "FormalPortalTest check_deposit_rejectsAmountAboveU128"
  "FormalPortalTest check_initialize_rejectsNonInitializer"
  "FormalPortalTest check_initializedBindingsCannotChange"
  "FormalRouterTest check_deposit_conservesUserFunds"
  "FormalRouterTest check_deposit_privateRequiresZeroRecipient"
  "FormalRouterTest check_deposit_publicRequiresRecipient"
  "FormalRouterTest check_deposit_rejectsAmountAboveU128"
  "FormalRouterTest check_deposit_rejectsZeroAmount"
)

# verify <log>: 0 when the passed pairs equal EXPECTED and no summary reports a failure; reasons on stderr otherwise.
verify() {
  local clean passed want fail=0
  # halmos colors its output even into a pipe.
  clean=$(sed -E 's/\x1b\[[0-9;]*m//g' "$1")
  passed=$(awk '/^Running [0-9]+ tests for /{n = split($NF, p, ":"); c = p[n]}
    /^\[PASS\] check_/{name = $2; sub(/\(.*/, "", name); print c " " name}' <<<"$clean" | sort)
  want=$(printf '%s\n' "${EXPECTED[@]}" | sort)
  if [ "$passed" != "$want" ]; then
    echo "halmos-gate: passed proofs differ from the expected set (< expected, > passed):" >&2
    diff <(printf '%s\n' "$want") <(printf '%s\n' "$passed") | grep '^[<>]' >&2 || true
    fail=1
  fi
  if grep -qE '^Symbolic test result: [0-9]+ passed; [1-9]' <<<"$clean"; then
    echo "halmos-gate: a symbolic proof failed or errored" >&2
    fail=1
  fi
  return "$fail"
}

self_test() {
  local tmp good fails=0
  tmp=$(mktemp -d)
  # shellcheck disable=SC2064 # expand now: tmp is local
  trap "rm -rf '$tmp'" EXIT
  good="Running 3 tests for test/FormalPortal.t.sol:FormalPortalTest
[PASS] check_deposit_rejectsAmountAboveU128(bytes32,uint256,bytes32) (paths: 1)
[PASS] check_initialize_rejectsNonInitializer(address,address,bytes32) (paths: 3)
[PASS] check_initializedBindingsCannotChange(address,bytes32) (paths: 2)
Symbolic test result: 3 passed; 0 failed; time: 0.25s
Running 5 tests for test/FormalRouter.t.sol:FormalRouterTest
[PASS] check_deposit_conservesUserFunds(uint128,uint128,uint128,bool) (paths: 478)
[PASS] check_deposit_privateRequiresZeroRecipient(uint128,bytes32) (paths: 7)
[PASS] check_deposit_publicRequiresRecipient(uint128) (paths: 6)
[PASS] check_deposit_rejectsAmountAboveU128(uint256,bytes32,bool) (paths: 2)
[PASS] check_deposit_rejectsZeroAmount(bytes32,bytes32,bool) (paths: 2)
Symbolic test result: 5 passed; 0 failed; time: 22.73s"
  printf '%s\n' "$good" >"$tmp/good"
  verify "$tmp/good" 2>/dev/null || {
    echo "SELF-TEST FAIL: the expected log was rejected" >&2
    fails=1
  }
  # The portal's cap proof replaced by an unrelated passing one: counts and names alone would still match.
  sed 's/check_deposit_rejectsAmountAboveU128(bytes32,uint256,bytes32)/check_unrelated(uint256)/' "$tmp/good" >"$tmp/swap"
  sed '/check_deposit_publicRequiresRecipient/d' "$tmp/good" >"$tmp/missing"
  sed 's/^\[PASS\] check_deposit_rejectsZeroAmount/[FAIL] check_deposit_rejectsZeroAmount/;
    s/^Symbolic test result: 5 passed; 0 failed/Symbolic test result: 4 passed; 1 failed/' "$tmp/good" >"$tmp/failing"
  for bad in swap missing failing; do
    if verify "$tmp/$bad" 2>/dev/null; then
      echo "SELF-TEST FAIL: the '$bad' log was accepted" >&2
      fails=1
    fi
  done
  [ "$fails" = 0 ] || exit 1
  echo "halmos-gate self-test passed: the expected set passes; swapped, missing and failing proofs are rejected"
}

if [ "${1:-}" = --self-test ]; then
  self_test
  exit 0
fi

log=$(mktemp)
trap 'rm -f "$log"' EXIT
# halmos reads the solc AST from the artifacts; without it halmos reports "No tests" and exits 0.
forge build --ast --force >/dev/null
halmos --match-contract '^Formal' 2>&1 | tee "$log"
verify "$log"
echo "halmos-gate: exactly the ${#EXPECTED[@]} expected proofs passed"
