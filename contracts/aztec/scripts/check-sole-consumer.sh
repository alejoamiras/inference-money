#!/usr/bin/env bash
# Static tripwire for the recipient-commitment property, which no TXE test can prove absent: the bridge must consume
# L1→L2 messages at EXACTLY two sites (claim_public, claim_private), and claim_private must
#   (a) take claim_salt and no raw-secret parameter,
#   (b) CALL derive_claim_secret(...) in its own body,
#   (c) pass that derived value, and only it, as the consume's secret,
#   (d) with no lower-level messaging/nullifier primitive anywhere that could consume around the check.
# Any stray consume site, raw-secret parameter or underived consume turns a private deposit into a bearer
# instrument that whoever holds (salt, amount, leaf) can redirect.
#
# Counts are occurrences across every non-test source the bridge executes (its own crate plus the local
# claim_secret lib), after stripping comments; claim_private is analysed on a newline-flattened copy because its
# signature spans lines. `--self-test` proves the guard rejects crafted regressions.
set -euo pipefail

aztec_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Drops block and line comments but keeps string literals (matched first in one alternation), so neither a
# commented-out shape nor a comment opener inside a string can hide or fake live code.
strip_comments() {
  LC_ALL=C perl -0pe 's{("(?:[^"\\]|\\.)*")|/\*.*?\*/|//[^\n]*}{defined $1 ? $1 : ""}gse'
}

violation() {
  echo "SOLE-CONSUMER VIOLATION: $*" >&2
  return 1
}

# check_file <main.nr> [extra source dir...]: 0 when the invariant holds, 1 with a reason on stderr otherwise.
check_file() {
  local main="$1"
  shift
  [ -f "$main" ] || violation "no such file: $main" || return 1
  local all consumers flat after params body derived
  all="$(find "$(dirname "$main")" "$@" -name '*.nr' -not -path '*/test/*' -exec cat {} + | strip_comments)"
  consumers=$(printf '%s' "$all" | grep -o consume_l1_to_l2_message | wc -l | tr -d ' ')
  [ "$consumers" -eq 2 ] || violation "expected 2 consume_l1_to_l2_message sites, found $consumers" || return 1
  if printf '%s' "$all" | grep -qE 'process_l1_to_l2_message|push_nullifier'; then
    violation "a lower-level messaging/nullifier primitive can consume around consume_l1_to_l2_message" || return 1
  fi

  flat=$(strip_comments <"$main" | tr '\n' ' ' | tr -s ' ')
  printf '%s' "$flat" | grep -q 'fn claim_private' || violation "no claim_private in $main" || return 1
  after=$(printf '%s' "$flat" | sed -E 's/.*fn claim_private//')
  params=$(printf '%s' "$after" | sed -E 's/\).*//')
  body=$(printf '%s' "$after" | sed -E 's/ fn .*//')

  # The legit parameters are {recipient, amount, claim_salt, message_leaf_index}; none contains "secret".
  printf '%s' "$params" | grep -q claim_salt || violation "claim_private no longer takes claim_salt" || return 1
  if printf '%s' "$params" | grep -qi secret; then
    violation "claim_private accepts a raw secret parameter" || return 1
  fi
  # A call (name followed by `(`), not the bare import.
  printf '%s' "$body" | grep -qE 'derive_claim_secret[[:space:]]*\(' ||
    violation "claim_private does not call derive_claim_secret(...)" || return 1
  derived=$(printf '%s' "$body" |
    sed -nE 's/.*let[[:space:]]+([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=[[:space:]]*derive_claim_secret[[:space:]]*\(.*/\1/p' | head -1)
  [ -n "$derived" ] && [ "$derived" != _ ] ||
    violation "claim_private does not bind the derived secret (let X = derive_claim_secret(...))" || return 1
  # aztec-nr 5 takes the secret as a one-element array; a second element would change the committed hash.
  printf '%s' "$body" |
    grep -qE "consume_l1_to_l2_message[[:space:]]*\([^,]*,[[:space:]]*(\[${derived}\]|${derived})[[:space:]]*," ||
    violation "claim_private does not consume with the derived secret ($derived)" || return 1
}

bridge_main="$aztec_root/token_bridge/src/main.nr"
lib_src="$aztec_root/claim_secret/src"

self_test() {
  local tmp fails=0 case
  tmp=$(mktemp -d)
  # shellcheck disable=SC2064 # expand now: tmp is local
  trap "rm -rf '$tmp'" EXIT
  check_file "$bridge_main" "$lib_src" >/dev/null 2>&1 || {
    echo "SELF-TEST FAIL: the real bridge source is rejected" >&2
    fails=1
  }
  mkdir -p "$tmp/lib"
  echo 'pub fn derive_claim_secret(s: Field, r: AztecAddress) -> Field { s }' >"$tmp/lib/lib.nr"
  local public='fn claim_public(to: AztecAddress, amount: u128, secret: Field, message_leaf_index: Field) {
    self.context.consume_l1_to_l2_message(content_hash, [secret], portal, message_leaf_index);
}'
  local header='use claim_secret_lib::derive_claim_secret;'

  # 1: multi-line signature that keeps claim_salt but adds a raw secret and consumes with it.
  cat >"$tmp/raw_secret.nr" <<EOF
$header
$public
fn claim_private(
    recipient: AztecAddress,
    amount: u128,
    claim_salt: Field,
    raw_secret: Field,
    message_leaf_index: Field,
) {
    self.context.consume_l1_to_l2_message(content_hash, [raw_secret], portal, message_leaf_index);
}
EOF
  # 2: import kept, no derive call.
  cat >"$tmp/no_call.nr" <<EOF
$header
$public
fn claim_private(recipient: AztecAddress, amount: u128, claim_salt: Field, message_leaf_index: Field) {
    self.context.consume_l1_to_l2_message(content_hash, [claim_salt], portal, message_leaf_index);
}
EOF
  # 3: a third consume site.
  cat >"$tmp/three.nr" <<EOF
$header
$public
fn b() { self.context.consume_l1_to_l2_message(y, [z], portal, 0); }
fn claim_private(recipient: AztecAddress, amount: u128, claim_salt: Field, message_leaf_index: Field) {
    let secret = derive_claim_secret(claim_salt, recipient);
    self.context.consume_l1_to_l2_message(content_hash, [secret], portal, message_leaf_index);
}
EOF
  # 4b: the derived secret is bound, but consumed beside the raw salt.
  cat >"$tmp/unused_derived.nr" <<EOF
$header
$public
fn claim_private(recipient: AztecAddress, amount: u128, claim_salt: Field, message_leaf_index: Field) {
    let secret = derive_claim_secret(claim_salt, recipient);
    self.context.consume_l1_to_l2_message(content_hash, [claim_salt, secret], portal, message_leaf_index);
}
EOF
  # 4: derive called, result discarded, raw salt consumed.
  cat >"$tmp/dataflow.nr" <<EOF
$header
$public
fn claim_private(recipient: AztecAddress, amount: u128, claim_salt: Field, message_leaf_index: Field) {
    let _ = derive_claim_secret(claim_salt, recipient);
    self.context.consume_l1_to_l2_message(content_hash, [claim_salt], portal, message_leaf_index);
}
EOF
  # 5: a lower-level primitive path beside a correct claim_private.
  cat >"$tmp/lowlevel.nr" <<EOF
$header
$public
fn claim_private(recipient: AztecAddress, amount: u128, claim_salt: Field, message_leaf_index: Field) {
    let secret = derive_claim_secret(claim_salt, recipient);
    self.context.consume_l1_to_l2_message(content_hash, [secret], portal, message_leaf_index);
}
fn claim_bearer(raw: Field, leaf: Field) {
    let m = self.context.process_l1_to_l2_message(raw, leaf);
    self.context.push_nullifier(m);
}
EOF
  # 6: two consume sites on one line (a line count sees one).
  cat >"$tmp/one_line.nr" <<EOF
$header
fn claim_public(to: AztecAddress, amount: u128, secret: Field, message_leaf_index: Field) {
    self.context.consume_l1_to_l2_message(content_hash, [secret], portal, message_leaf_index); self.context.consume_l1_to_l2_message(other, [secret], portal, other_leaf);
}
fn claim_private(recipient: AztecAddress, amount: u128, claim_salt: Field, message_leaf_index: Field) {
    let secret = derive_claim_secret(claim_salt, recipient);
    self.context.consume_l1_to_l2_message(content_hash, [secret], portal, message_leaf_index);
}
EOF
  # 7: the expected shape survives only in comments; the live consume is a bearer one.
  cat >"$tmp/commented.nr" <<EOF
$header
$public
fn claim_private(recipient: AztecAddress, amount: u128, claim_salt: Field, message_leaf_index: Field) {
    // let secret = derive_claim_secret(claim_salt, recipient);
    // self.context.consume_l1_to_l2_message(content_hash, [secret], portal, message_leaf_index);
    self.context.consume_l1_to_l2_message(content_hash, [claim_salt], portal, message_leaf_index);
}
EOF
  # 8: a `//` inside a string must not hide the live primitive after it.
  cat >"$tmp/string_slash.nr" <<EOF
$header
$public
fn claim_private(recipient: AztecAddress, amount: u128, claim_salt: Field, message_leaf_index: Field) {
    let secret = derive_claim_secret(claim_salt, recipient);
    let url = "https://x"; let m = self.context.process_l1_to_l2_message(claim_salt, message_leaf_index);
    self.context.consume_l1_to_l2_message(content_hash, [secret], portal, message_leaf_index);
}
EOF
  # 9: a block-comment opener and closer inside two strings bracket a live primitive.
  cat >"$tmp/string_block.nr" <<EOF
$header
$public
fn claim_private(recipient: AztecAddress, amount: u128, claim_salt: Field, message_leaf_index: Field) {
    let secret = derive_claim_secret(claim_salt, recipient);
    let open = "/*";
    let m = self.context.process_l1_to_l2_message(claim_salt, message_leaf_index);
    let close = "*/";
    self.context.consume_l1_to_l2_message(content_hash, [secret], portal, message_leaf_index);
}
EOF
  # Each rejection prints its reason, so a regression tripping the wrong check is visible.
  expect_rejected() {
    local name="$1" reason
    shift
    if reason=$(check_file "$@" 2>&1); then
      echo "SELF-TEST FAIL: regression '$name' accepted" >&2
      fails=1
    else
      echo "  $name → ${reason#SOLE-CONSUMER VIOLATION: }"
    fi
  }
  # One directory per fixture: check_file scans its main file's whole directory.
  for case in raw_secret no_call three dataflow unused_derived lowlevel one_line commented string_slash string_block; do
    mkdir "$tmp/$case"
    mv "$tmp/$case.nr" "$tmp/$case/main.nr"
    expect_rejected "$case" "$tmp/$case/main.nr" "$tmp/lib"
  done
  # 11: a consume smuggled into the claim_secret lib the bridge executes.
  echo 'fn f() { self.context.consume_l1_to_l2_message(a, [b], c, d); }' >>"$tmp/lib/lib.nr"
  expect_rejected lib_consume "$bridge_main" "$tmp/lib"
  [ "$fails" = 0 ] || exit 1
  echo "✅ check-sole-consumer self-test passed (real source upheld; 11 bearer regressions rejected)"
}

if [ "${1:-}" = "--self-test" ]; then
  self_test
  exit 0
fi
check_file "$bridge_main" "$lib_src" || exit 1
echo "✅ sole-consumer invariant holds: 2 sites (claim_public, claim_private); claim_private consumes only a derived secret"
