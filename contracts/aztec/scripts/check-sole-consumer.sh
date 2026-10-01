#!/usr/bin/env bash
# Static tripwire for what no TXE test can prove absent: the bridge consumes L1→L2 messages at EXACTLY four sites, each
# bound to its own message type and sent by config.portal, and the rules guarding them are still in their bodies, behind
# no control flow but the rule branches (`if bind`, `if as_merchant`). It pins text and shape; the TXE suites prove that
# each rule refuses.
#   claim_public:           consumes mint_to_public(to, amount, depositor) with the caller's secret; `to` must be a
#                           merchant; mints to `to`; messages no portal.
#   return_deposit_public:  the same consumption; refuses a merchant `to`; pays `depositor` on L1, once, and mints nothing.
#   claim_private:          takes claim_salt and no raw-secret parameter; consumes mint_to_private(amount, depositor)
#                           with exactly derive_claim_secret(claim_salt, recipient); only `recipient` submits it; the
#                           first claim binds `depositor`, every later one must match it; mints to `recipient`.
#   return_deposit_private: the same consumption; pays `depositor` on L1, once, and mints nothing.
#   exit_to_l1_public needs a merchant sender; exit_to_l1_private holds a merchant to try_prove_merchant and a user to
#   its funding address.
# No lower-level messaging/nullifier primitive may exist anywhere to consume around these checks. A stray site, raw
# secret, foreign sender or misdirected payout turns a deposit into something whoever holds (salt, amount, leaf) can
# redirect, or lets an attacker's L1 contract mint unbacked tokens.
#
# Counts are occurrences across every non-test source the bridge executes (its crate plus the local claim_secret and
# portal_messages libs), after stripping comments; bodies are analysed on a newline-flattened copy because signatures
# span lines.
# `--self-test` mutates the real source one rule at a time and requires each mutant to fail for its own reason.
set -euo pipefail

aztec_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bridge_main="$aztec_root/token_bridge/src/main.nr"
lib_src="$aztec_root/claim_secret/src"
messages_src="$aztec_root/portal_messages/src"

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
config_read="let config${S}=${S}self\\.storage\\.config\\.read\\(\\)"
token_view="self\\.view\\(${S}Token::at\\(${S}config\\.token${S}\\)"

# fn_body <flat source> <name>: the text from `fn <name>` up to the next ` fn `.
fn_body() {
  printf '%s' "$1" | sed -E "s/.*fn $2${S}\(/(/; s/ fn .*//"
}

# bound_to <body> <call regex>: the variable a `let X = <call>` binds, if any.
bound_to() {
  printf '%s' "$1" | sed -nE "s/.*let[[:space:]]+([A-Za-z_][A-Za-z0-9_]*)${S}=${S}$2.*/\\1/p" | head -1
}

# need <fn> <body> <regex> <reason>: a violation unless the body matches.
need() {
  printf '%s' "$2" | grep -qE "$3" || violation "$1 $4"
}

# consumes_public <fn> <body>: hashes mint_to_public(to, amount, depositor) and consumes it with `secret` from
# config.portal.
consumes_public() {
  local content
  content=$(bound_to "$2" "mint_to_public_content_hash${S}\\(${S}to${S},${S}amount${S},${S}depositor${S}\\)")
  [ -n "$content" ] || violation "$1 does not hash mint_to_public(to, amount, depositor)" || return 1
  need "$1" "$2" "$config_read" "does not read config from storage" || return 1
  need "$1" "$2" "consume_l1_to_l2_message${S}\\(${S}${content}${S},${S}\\[${S}secret${S}\\]${S},${S}config\\.portal${S}," \
    "does not consume its public content hash from config.portal"
}

# consumes_derived <fn> <body>: takes claim_salt and no raw secret, and consumes mint_to_private(amount, depositor) with
# exactly derive_claim_secret(claim_salt, recipient) from config.portal.
consumes_derived() {
  local params derived content
  params=$(printf '%s' "$2" | sed -E 's/\).*//')
  printf '%s' "$params" | grep -q claim_salt || violation "$1 no longer takes claim_salt" || return 1
  if printf '%s' "$params" | grep -qi secret; then
    violation "$1 accepts a raw secret parameter" || return 1
  fi
  need "$1" "$2" "derive_claim_secret${S}\\(" "does not call derive_claim_secret(...)" || return 1
  derived=$(bound_to "$2" "derive_claim_secret${S}\\(")
  [ -n "$derived" ] && [ "$derived" != _ ] ||
    violation "$1 does not bind the derived secret (let X = derive_claim_secret(...))" || return 1
  need "$1" "$2" "let ${derived}${S}=${S}derive_claim_secret${S}\\(${S}claim_salt${S},${S}recipient${S}\\)" \
    "does not derive from (claim_salt, recipient)" || return 1
  content=$(bound_to "$2" "mint_to_private_content_hash${S}\\(${S}amount${S},${S}depositor${S}\\)")
  [ -n "$content" ] || violation "$1 does not hash mint_to_private(amount, depositor)" || return 1
  need "$1" "$2" "$config_read" "does not read config from storage" || return 1
  # aztec-nr takes the secret as a one-element array; a second element would change the committed hash.
  need "$1" "$2" \
    "consume_l1_to_l2_message${S}\\(${S}${content}${S},${S}\\[${S}${derived}${S}\\]${S},${S}config\\.portal${S}," \
    "does not consume its private content hash with the derived secret ($derived) from config.portal"
}

# flow_is <fn> <body> <conditions>: the body branches only on the rule conditions given (space-separated, in order) and
# has no loop, match or closure: `if false { assert(…) }` keeps exactly the text the other checks match, but never runs.
flow_is() {
  local code ifs
  code=$(printf '%s' "$2" | sed -E 's/"([^"\\]|\\.)*"//g')
  if printf '%s' "$code" | grep -qE '(^|[^A-Za-z0-9_])(for|while|loop|match)([^A-Za-z0-9_]|$)|[|]'; then
    violation "$1 has a loop, match or closure" || return 1
  fi
  ifs=$(printf '%s' "$code" | grep -oE "(^|[^A-Za-z0-9_])if[[:space:]]+[^{]*[{]" | sed -E "s/^[^i]*if${S}//; s/${S}[{]$//" |
    tr '\n' ' ' | sed -E 's/ $//')
  [ "$ifs" = "$3" ] || violation "$1 branches on [$ifs], not exactly on the rule conditions [$3]"
}

# A claim mints and nothing else: a withdraw from the same consumption would pay the deposit out twice.
no_portal_message() {
  if printf '%s' "$2" | grep -q message_portal; then
    violation "$1 messages the portal" || return 1
  fi
}

# pays_depositor <fn> <body>: one withdraw, to the depositor the consumed content names, and no mint.
pays_depositor() {
  need "$1" "$2" \
    "message_portal${S}\\(${S}config\\.portal${S},${S}withdraw_content_hash${S}\\(${S}depositor${S},${S}amount${S},${S}EthAddress::zero\\(\\)${S}\\)${S}\\)" \
    "does not pay the depositor" || return 1
  [ "$(printf '%s' "$2" | grep -o message_portal | wc -l | tr -d ' ')" -eq 1 ] ||
    violation "$1 messages the portal more than once" || return 1
  if printf '%s' "$2" | sed -E 's/mint_to_(public|private)_content_hash//g' | grep -q mint; then
    violation "$1 mints" || return 1
  fi
}

check_claim_public() {
  local body
  body=$(fn_body "$1" claim_public)
  consumes_public claim_public "$body" || return 1
  need claim_public "$body" "assert${S}\\(${S}${token_view}\\.is_merchant\\(${S}to${S}\\)${S}\\)${S}," \
    "does not require a merchant recipient" || return 1
  need claim_public "$body" "\\.mint_to_public${S}\\(${S}to${S},${S}amount${S}\\)" \
    "does not mint to the hashed recipient" || return 1
  no_portal_message claim_public "$body" || return 1
  flow_is claim_public "$body" ""
}

check_claim_private() {
  local body
  body=$(fn_body "$1" claim_private)
  consumes_derived claim_private "$body" || return 1
  need claim_private "$body" "assert${S}\\(${S}self\\.msg_sender\\(\\)${S}==${S}recipient${S}," \
    "does not require the recipient to submit it" || return 1
  need claim_private "$body" "let funding${S}=${S}self\\.storage\\.funding_address\\.at\\(${S}recipient${S}\\)${S};" \
    "does not read the recipient's binding" || return 1
  need claim_private "$body" \
    "if${S}bind${S}\\{${S}funding\\.initialize\\(${S}FundingAddressNote${S}\\{${S}address${S}:${S}depositor${S}\\}${S}\\)" \
    "does not bind the deposit's depositor" || return 1
  need claim_private "$body" "\\}${S}else${S}\\{${S}assert${S}\\(${S}funding\\.get_note\\(\\)\\.address${S}==${S}depositor${S}," \
    "does not hold a later deposit to the funding address" || return 1
  need claim_private "$body" "\\.mint_to_private${S}\\(${S}recipient${S},${S}amount${S}\\)" \
    "does not mint to the committed recipient" || return 1
  no_portal_message claim_private "$body" || return 1
  flow_is claim_private "$body" bind
}

check_returns() {
  local body
  body=$(fn_body "$1" return_deposit_private)
  consumes_derived return_deposit_private "$body" || return 1
  pays_depositor return_deposit_private "$body" || return 1
  flow_is return_deposit_private "$body" "" || return 1
  body=$(fn_body "$1" return_deposit_public)
  consumes_public return_deposit_public "$body" || return 1
  need return_deposit_public "$body" "assert${S}\\(${S}!${S}${token_view}\\.is_merchant\\(${S}to${S}\\)${S}\\)${S}," \
    "does not refuse a merchant's deposit" || return 1
  pays_depositor return_deposit_public "$body" || return 1
  flow_is return_deposit_public "$body" ""
}

check_exits() {
  local body
  body=$(fn_body "$1" exit_to_l1_public)
  need exit_to_l1_public "$body" "assert${S}\\(${S}${token_view}\\.is_merchant\\(${S}sender${S}\\)${S}\\)${S}," \
    "does not require a merchant sender" || return 1
  flow_is exit_to_l1_public "$body" "" || return 1
  body=$(fn_body "$1" exit_to_l1_private)
  need exit_to_l1_private "$body" \
    "if${S}as_merchant${S}\\{${S}assert${S}\\(${S}${token_view}\\.try_prove_merchant\\(${S}sender${S}\\)${S}\\)${S}," \
    "does not require try_prove_merchant for a merchant exit" || return 1
  need exit_to_l1_private "$body" \
    "\\}${S}else${S}\\{.*assert${S}\\(${S}self\\.storage\\.funding_address\\.at\\(${S}sender${S}\\)\\.get_note\\(\\)\\.address${S}==${S}recipient${S}," \
    "does not hold a user to its funding address" || return 1
  flow_is exit_to_l1_private "$body" as_merchant
}

# check_file <main.nr> [extra source dir...]: 0 when the invariant holds, 1 with a reason on stderr otherwise.
check_file() {
  local main="$1" all consumers flat name
  shift
  [ -f "$main" ] || violation "no such file: $main" || return 1
  all="$(find "$(dirname "$main")" "$@" -name '*.nr' -not -path '*/test/*' -exec cat {} + | strip_comments)"
  consumers=$(printf '%s' "$all" | grep -o consume_l1_to_l2_message | wc -l | tr -d ' ')
  [ "$consumers" -eq 4 ] || violation "expected 4 consume_l1_to_l2_message sites, found $consumers" || return 1
  if printf '%s' "$all" | grep -qE 'process_l1_to_l2_message|push_nullifier'; then
    violation "a lower-level messaging/nullifier primitive can consume around consume_l1_to_l2_message" || return 1
  fi
  flat=$(strip_comments <"$main" | tr '\n' ' ' | tr -s ' ')
  for name in claim_public claim_private return_deposit_private return_deposit_public exit_to_l1_public \
    exit_to_l1_private; do
    printf '%s' "$flat" | grep -qE "fn ${name}${S}\\(" || violation "no $name in $main" || return 1
  done
  check_claim_public "$flat" && check_claim_private "$flat" && check_returns "$flat" && check_exits "$flat"
}

self_test() {
  local tmp fails=0 count=0
  tmp=$(mktemp -d)
  # shellcheck disable=SC2064 # expand now: tmp is local
  trap "rm -rf '$tmp'" EXIT
  check_file "$bridge_main" "$lib_src" "$messages_src" >/dev/null 2>&1 || {
    echo "SELF-TEST FAIL: the real bridge source is rejected" >&2
    fails=1
  }

  # mutant <name> <expected reason> <main|lib> <from> <to> [nth]: the real crate with ONE literal substitution (of the
  # nth occurrence, default the first), which must apply and must be rejected for the expected reason.
  mutant() {
    local name="$1" want="$2" dir="$tmp/$1" target reason
    count=$((count + 1))
    mkdir -p "$dir/src" "$dir/lib" "$dir/messages"
    cp "$bridge_main" "$dir/src/main.nr"
    cp "$lib_src"/*.nr "$dir/lib/"
    cp "$messages_src"/*.nr "$dir/messages/"
    target="$dir/src/main.nr"
    [ "$3" = lib ] && target="$dir/lib/lib.nr"
    if ! FROM="$4" TO="$5" NTH="${6:-1}" perl -0pi -e \
      'my $c = 0; s/\Q$ENV{FROM}\E/++$c == $ENV{NTH} ? $ENV{TO} : $&/ge; die "no match\n" if $c < $ENV{NTH}' \
      "$target" 2>/dev/null; then
      echo "SELF-TEST FAIL: '$name' mutation did not apply" >&2
      fails=1
      return
    fi
    if reason=$(check_file "$dir/src/main.nr" "$dir/lib" "$dir/messages" 2>&1); then
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
  local payout='withdraw_content_hash(depositor, amount, EthAddress::zero())'
  local public_consume='[secret], config.portal, message_leaf_index);'

  # Consumption: the sites, their message types, secrets and sender.
  mutant raw_secret "claim_private accepts a raw secret parameter" main "claim_salt: Field," \
    "claim_salt: Field, raw_secret: Field,"
  mutant no_call "claim_private does not call derive_claim_secret" main "$derive" "let secret = claim_salt;"
  mutant discarded "does not bind the derived secret" main "$derive" \
    "let _ = derive_claim_secret(claim_salt, recipient); let secret = claim_salt;"
  mutant from_sender "does not derive from (claim_salt, recipient)" main "$derive" \
    "let secret = derive_claim_secret(claim_salt, self.msg_sender());"
  mutant extra_element "with the derived secret" main "content_hash,
[secret]," "content_hash,
[claim_salt, secret],"
  mutant public_redeems_private "claim_public does not hash mint_to_public" main \
    "mint_to_public_content_hash(to, amount, depositor)" "mint_to_private_content_hash(amount, depositor)"
  mutant foreign_sender "claim_public does not consume its public content hash from config.portal" main \
    "$public_consume" "[secret], sender, message_leaf_index);"
  mutant private_foreign_sender "claim_private does not consume its private content hash with the derived secret" \
    main "[secret],
config.portal," "[secret],
sender,"
  mutant mint_to_sender "claim_private does not mint to the committed recipient" main \
    "mint_to_private(recipient, amount)" "mint_to_private(self.msg_sender(), amount)"
  mutant fifth_site "found 5" main "$exits" \
    "fn b() { self.context.consume_l1_to_l2_message(y, [z], config.portal, 0); } $exits"
  mutant one_line "found 5" main "config.portal, message_leaf_index);" \
    "config.portal, message_leaf_index); self.context.consume_l1_to_l2_message(o, [s], config.portal, 1);"
  mutant lowlevel "lower-level messaging/nullifier primitive" main "$exits" \
    "fn claim_bearer(raw: Field, leaf: Field) { let m = self.context.process_l1_to_l2_message(raw, leaf); self.context.push_nullifier(m); } $exits"
  mutant commented "does not call derive_claim_secret" main "$derive" "// $derive
let secret = claim_salt;"
  mutant string_slash "lower-level messaging/nullifier primitive" main "$derive" \
    "$derive let url = \"https://x\"; let m = self.context.process_l1_to_l2_message(claim_salt, message_leaf_index);"
  mutant string_block "lower-level messaging/nullifier primitive" main "$derive" \
    "$derive let open = \"/*\"; let m = self.context.process_l1_to_l2_message(claim_salt, message_leaf_index); let close = \"*/\";"
  mutant lib_consume "found 5" lib "pub fn derive_claim_secret" \
    "fn f() { self.context.consume_l1_to_l2_message(a, [b], c, d); }
pub fn derive_claim_secret"
  mutant return_raw_secret "return_deposit_private accepts a raw secret parameter" main "depositor: EthAddress,
) {" "depositor: EthAddress,
secret: Field,
) {"
  mutant return_underived "return_deposit_private does not call derive_claim_secret" main "$derive" \
    "let secret = claim_salt;" 2
  mutant return_foreign_sender "return_deposit_public does not consume its public content hash from config.portal" \
    main "$public_consume" "[secret], depositor_contract, message_leaf_index);" 2

  # Returns: the depositor is paid, once, and nothing is minted.
  mutant return_pays_caller "return_deposit_private does not pay the depositor" main "$payout" \
    "withdraw_content_hash(caller, amount, EthAddress::zero())"
  mutant return_pays_recipient "return_deposit_public does not pay the depositor" main "$payout" \
    "withdraw_content_hash(to, amount, EthAddress::zero())" 2
  mutant return_pays_twice "return_deposit_private messages the portal more than once" main "$payout);" \
    "$payout); self.context.message_portal(config.portal, withdraw_content_hash(caller, amount, EthAddress::zero()));"
  mutant return_mints "return_deposit_public mints" main "$payout);" \
    "$payout); self.call(TokenMinterProxy::at(config.token_minter_proxy).mint_to_public(to, amount));" 2
  mutant return_bounces_merchant "return_deposit_public does not refuse a merchant's deposit" main \
    'assert(!self.view(Token::at(config.token).is_merchant(to)), "A merchant'"'"'s public deposit is claimed, not returned");' ""
  mutant claim_withdraws "claim_public messages the portal" main \
    "self.call(TokenMinterProxy::at(config.token_minter_proxy).mint_to_public(to, amount));" \
    "self.call(TokenMinterProxy::at(config.token_minter_proxy).mint_to_public(to, amount)); self.context.message_portal(config.portal, $payout);"

  # Rules: merchants, the self-claim, the binding and the exits.
  mutant public_claim_for_users "claim_public does not require a merchant recipient" main \
    'assert(self.view(Token::at(config.token).is_merchant(to)), "Public claims are for merchants only");' ""
  mutant relayed_private_claim "claim_private does not require the recipient to submit it" main \
    'assert(self.msg_sender() == recipient, "Only the recipient can claim privately");' ""
  mutant binds_another "claim_private does not bind the deposit's depositor" main \
    "FundingAddressNote { address: depositor }" "FundingAddressNote { address: EthAddress::zero() }"
  mutant unchecked_binding "claim_private does not hold a later deposit to the funding address" main \
    "assert(funding.get_note().address == depositor, \"Deposit is not from this account's funding address\");" \
    "let _ = funding.get_note();"
  mutant user_exits_anywhere "exit_to_l1_private does not hold a user to its funding address" main \
    "self.storage.funding_address.at(sender).get_note().address == recipient" "bound"
  mutant merchant_flag_unchecked "exit_to_l1_private does not require try_prove_merchant" main "assert(
self.view(Token::at(config.token).try_prove_merchant(sender))," \
    "let _ = self.view(Token::at(config.token).try_prove_merchant(sender));
assert(
true,"
  mutant public_exit_for_users "exit_to_l1_public does not require a merchant sender" main \
    'assert(self.view(Token::at(config.token).is_merchant(sender)), "Public exits are for merchants only");' ""

  # Control flow: a rule's text kept behind a branch or loop that never runs it.
  mutant dead_branch "exit_to_l1_private branches on [as_merchant false]" main \
    "assert(
self.storage.funding_address.at(sender).get_note().address == recipient," \
    "if false { assert(
self.storage.funding_address.at(sender).get_note().address == recipient,"
  mutant dead_loop "claim_private has a loop, match or closure" main \
    'assert(self.msg_sender() == recipient, "Only the recipient can claim privately");' \
    'for _ in 0..0 { assert(self.msg_sender() == recipient, "Only the recipient can claim privately"); }'

  [ "$fails" = 0 ] || exit 1
  echo "✅ check-sole-consumer self-test passed (real source upheld; $count single-rule mutants rejected for their own reasons)"
}

if [ "${1:-}" = "--self-test" ]; then
  self_test
  exit 0
fi
check_file "$bridge_main" "$lib_src" "$messages_src" || exit 1
echo "✅ sole-consumer invariant holds: four consume sites, each bound to its own message type from config.portal;" \
  "the private ones consume only the recipient-derived secret; returns pay their depositor and never mint; the" \
  "merchant, binding and exit rules are in place, behind no control flow but their own branches"
