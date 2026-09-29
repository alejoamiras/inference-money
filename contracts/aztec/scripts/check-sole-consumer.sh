#!/usr/bin/env bash
# Static tripwire for what no TXE test can prove absent: the bridge consumes L1→L2 messages at EXACTLY two sites, and
# each is bound to its own message type.
#   claim_public:  hashes mint_to_public(to, amount), consumes it from config.portal, mints to `to`.
#   claim_private: takes claim_salt and no raw-secret parameter; derives `derive_claim_secret(claim_salt, recipient)`;
#                  hashes mint_to_private(amount); consumes with exactly that derived secret from config.portal;
#                  mints to `recipient`.
# No lower-level messaging/nullifier primitive may exist anywhere to consume around these checks. Any stray site, raw
# secret, private hash reachable from claim_public, or foreign sender turns a deposit into something whoever holds
# (salt, amount, leaf) can redirect, or lets an attacker's L1 contract mint unbacked tokens.
#
# Counts are occurrences across every non-test source the bridge executes (its crate plus the local claim_secret
# lib), after stripping comments; bodies are analysed on a newline-flattened copy because signatures span lines.
# `--self-test` mutates the real source one rule at a time and requires each mutant to fail for its own reason.
set -euo pipefail

aztec_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bridge_main="$aztec_root/token_bridge/src/main.nr"
lib_src="$aztec_root/claim_secret/src"

# Drops block and line comments but keeps string literals (matched first in one alternation), so neither a
# commented-out shape nor a comment opener inside a string can hide or fake live code.
strip_comments() {
  LC_ALL=C perl -0pe 's{("(?:[^"\\]|\\.)*")|/\*.*?\*/|//[^\n]*}{defined $1 ? $1 : ""}gse'
}

violation() {
  echo "SOLE-CONSUMER VIOLATION: $*" >&2
  return 1
}

S='[[:space:]]*'

# fn_body <flat source> <name>: the text from `fn <name>` up to the next ` fn `.
fn_body() {
  printf '%s' "$1" | sed -E "s/.*fn $2${S}\(/(/; s/ fn .*//"
}

# bound_to <body> <call regex>: the variable a `let X = <call>` binds, if any.
bound_to() {
  printf '%s' "$1" | sed -nE "s/.*let[[:space:]]+([A-Za-z_][A-Za-z0-9_]*)${S}=${S}$2.*/\\1/p" | head -1
}

check_public() {
  local body content
  body=$(fn_body "$1" claim_public)
  content=$(bound_to "$body" "get_mint_to_public_content_hash${S}\\(${S}to${S},${S}amount${S}\\)")
  [ -n "$content" ] || violation "claim_public does not hash mint_to_public(to, amount)" || return 1
  printf '%s' "$body" | grep -qE "let config${S}=${S}self\\.storage\\.config\\.read\\(\\)" ||
    violation "claim_public does not read config from storage" || return 1
  printf '%s' "$body" |
    grep -qE "consume_l1_to_l2_message${S}\\(${S}${content}${S},${S}\\[${S}secret${S}\\]${S},${S}config\\.portal${S}," ||
    violation "claim_public does not consume its public content hash from config.portal" || return 1
  printf '%s' "$body" | grep -qE "\\.mint_to_public${S}\\(${S}to${S},${S}amount${S}\\)" ||
    violation "claim_public does not mint to the hashed recipient" || return 1
}

check_private() {
  local body params derived content
  body=$(fn_body "$1" claim_private)
  params=$(printf '%s' "$body" | sed -E 's/\).*//')
  # The legit parameters are {recipient, amount, claim_salt, message_leaf_index}; none contains "secret".
  printf '%s' "$params" | grep -q claim_salt || violation "claim_private no longer takes claim_salt" || return 1
  if printf '%s' "$params" | grep -qi secret; then
    violation "claim_private accepts a raw secret parameter" || return 1
  fi
  printf '%s' "$body" | grep -qE "derive_claim_secret${S}\\(" ||
    violation "claim_private does not call derive_claim_secret(...)" || return 1
  derived=$(bound_to "$body" "derive_claim_secret${S}\\(")
  [ -n "$derived" ] && [ "$derived" != _ ] ||
    violation "claim_private does not bind the derived secret (let X = derive_claim_secret(...))" || return 1
  printf '%s' "$body" |
    grep -qE "let ${derived}${S}=${S}derive_claim_secret${S}\\(${S}claim_salt${S},${S}recipient${S}\\)" ||
    violation "claim_private does not derive from (claim_salt, recipient)" || return 1
  content=$(bound_to "$body" "get_mint_to_private_content_hash${S}\\(${S}amount${S}\\)")
  [ -n "$content" ] || violation "claim_private does not hash mint_to_private(amount)" || return 1
  printf '%s' "$body" | grep -qE "let config${S}=${S}self\\.storage\\.config\\.read\\(\\)" ||
    violation "claim_private does not read config from storage" || return 1
  # aztec-nr 5 takes the secret as a one-element array; a second element would change the committed hash.
  printf '%s' "$body" |
    grep -qE "consume_l1_to_l2_message${S}\\(${S}${content}${S},${S}\\[${S}${derived}${S}\\]${S},${S}config\\.portal${S}," ||
    violation "claim_private does not consume its private content hash with the derived secret ($derived) from config.portal" ||
    return 1
  printf '%s' "$body" | grep -qE "\\.mint_to_private${S}\\(${S}recipient${S},${S}amount${S}\\)" ||
    violation "claim_private does not mint to the committed recipient" || return 1
}

# check_file <main.nr> [extra source dir...]: 0 when the invariant holds, 1 with a reason on stderr otherwise.
check_file() {
  local main="$1" all consumers flat
  shift
  [ -f "$main" ] || violation "no such file: $main" || return 1
  all="$(find "$(dirname "$main")" "$@" -name '*.nr' -not -path '*/test/*' -exec cat {} + | strip_comments)"
  consumers=$(printf '%s' "$all" | grep -o consume_l1_to_l2_message | wc -l | tr -d ' ')
  [ "$consumers" -eq 2 ] || violation "expected 2 consume_l1_to_l2_message sites, found $consumers" || return 1
  if printf '%s' "$all" | grep -qE 'process_l1_to_l2_message|push_nullifier'; then
    violation "a lower-level messaging/nullifier primitive can consume around consume_l1_to_l2_message" || return 1
  fi
  flat=$(strip_comments <"$main" | tr '\n' ' ' | tr -s ' ')
  printf '%s' "$flat" | grep -q 'fn claim_public' || violation "no claim_public in $main" || return 1
  printf '%s' "$flat" | grep -q 'fn claim_private' || violation "no claim_private in $main" || return 1
  check_public "$flat" && check_private "$flat"
}

self_test() {
  local tmp fails=0
  tmp=$(mktemp -d)
  # shellcheck disable=SC2064 # expand now: tmp is local
  trap "rm -rf '$tmp'" EXIT
  check_file "$bridge_main" "$lib_src" >/dev/null 2>&1 || {
    echo "SELF-TEST FAIL: the real bridge source is rejected" >&2
    fails=1
  }

  # mutant <name> <expected reason> <main|lib> <from> <to>: the real crate with ONE literal substitution, which must
  # apply and must be rejected for the expected reason.
  mutant() {
    local name="$1" want="$2" dir="$tmp/$1" target reason
    mkdir -p "$dir/src" "$dir/lib"
    cp "$bridge_main" "$dir/src/main.nr"
    cp "$lib_src"/*.nr "$dir/lib/"
    target="$dir/src/main.nr"
    [ "$3" = lib ] && target="$dir/lib/lib.nr"
    if ! FROM="$4" TO="$5" perl -0pi -e 's/\Q$ENV{FROM}\E/$ENV{TO}/ or die "no match\n"' "$target" 2>/dev/null; then
      echo "SELF-TEST FAIL: '$name' mutation did not apply" >&2
      fails=1
      return
    fi
    if reason=$(check_file "$dir/src/main.nr" "$dir/lib" 2>&1); then
      echo "SELF-TEST FAIL: '$name' accepted" >&2
      fails=1
    elif [[ "$reason" != *"$want"* ]]; then
      echo "SELF-TEST FAIL: '$name' rejected for the wrong reason: $reason" >&2
      fails=1
    else
      echo "  $name → ${reason#SOLE-CONSUMER VIOLATION: }"
    fi
  }

  local derive='let secret = derive_claim_secret(claim_salt, recipient);'
  local exits='#[external("public")]
fn exit_to_l1_public('
  mutant raw_secret "raw secret parameter" main "claim_salt: Field," "claim_salt: Field, raw_secret: Field,"
  mutant no_call "does not call derive_claim_secret" main "$derive" "let secret = claim_salt;"
  mutant discarded "does not bind the derived secret" main "$derive" \
    "let _ = derive_claim_secret(claim_salt, recipient); let secret = claim_salt;"
  mutant from_sender "does not derive from (claim_salt, recipient)" main "$derive" \
    "let secret = derive_claim_secret(claim_salt, self.msg_sender());"
  mutant extra_element "with the derived secret" main "content_hash,
[secret]," "content_hash,
[claim_salt, secret],"
  mutant public_redeems_private "claim_public does not hash mint_to_public" main \
    "get_mint_to_public_content_hash(to, amount)" "get_mint_to_private_content_hash(amount)"
  mutant foreign_sender "claim_public does not consume its public content hash from config.portal" main \
    "[secret], config.portal, message_leaf_index);" "[secret], sender, message_leaf_index);"
  mutant mint_to_sender "claim_private does not mint to the committed recipient" main \
    "mint_to_private(recipient, amount)" "mint_to_private(self.msg_sender(), amount)"
  mutant third_site "found 3" main "$exits" \
    "fn b() { self.context.consume_l1_to_l2_message(y, [z], config.portal, 0); } $exits"
  mutant one_line "found 3" main "config.portal, message_leaf_index);" \
    "config.portal, message_leaf_index); self.context.consume_l1_to_l2_message(o, [s], config.portal, 1);"
  mutant lowlevel "lower-level messaging/nullifier primitive" main "$exits" \
    "fn claim_bearer(raw: Field, leaf: Field) { let m = self.context.process_l1_to_l2_message(raw, leaf); self.context.push_nullifier(m); } $exits"
  mutant commented "does not call derive_claim_secret" main "$derive" "// $derive
let secret = claim_salt;"
  mutant string_slash "lower-level messaging/nullifier primitive" main "$derive" \
    "$derive let url = \"https://x\"; let m = self.context.process_l1_to_l2_message(claim_salt, message_leaf_index);"
  mutant string_block "lower-level messaging/nullifier primitive" main "$derive" \
    "$derive let open = \"/*\"; let m = self.context.process_l1_to_l2_message(claim_salt, message_leaf_index); let close = \"*/\";"
  mutant lib_consume "found 3" lib "pub fn derive_claim_secret" \
    "fn f() { self.context.consume_l1_to_l2_message(a, [b], c, d); }
pub fn derive_claim_secret"

  [ "$fails" = 0 ] || exit 1
  echo "✅ check-sole-consumer self-test passed (real source upheld; 15 single-rule mutants rejected for their own reasons)"
}

if [ "${1:-}" = "--self-test" ]; then
  self_test
  exit 0
fi
check_file "$bridge_main" "$lib_src" || exit 1
echo "✅ sole-consumer invariant holds: claim_public and claim_private each consume only their own message type" \
  "from config.portal; claim_private consumes only the recipient-derived secret"
