#!/usr/bin/env bash
# Sourced by the static tripwires: text checks over comment-stripped, newline-flattened Noir source. Each caller defines
# `violation <reason>` (print it, return 1).

S='[[:space:]]*'

# Drops block and line comments and empties string literals (matched first in one alternation, so a comment opener
# inside a string is never read as one): no check can match commented-out or quoted text as code.
strip_comments() {
  LC_ALL=C perl -0pe 's{("(?:[^"\\]|\\.)*")|/\*.*?\*/|//[^\n]*}{defined $1 ? q("") : ""}gse'
}

# fn_body <flat source> <name>: the text from `fn <name>` up to the next ` fn `.
fn_body() {
  printf '%s' "$1" | sed -E "s/.*fn $2${S}\(/(/; s/ fn .*//"
}

# need <fn> <body> <regex> <reason>: a violation unless the body matches.
need() {
  printf '%s' "$2" | grep -qE "$3" || violation "$1 $4"
}

# flow_is <fn> <body> <conditions>: the body branches only on the conditions given (space-separated, in order) and has
# no loop, match or closure: `if false { assert(…) }` keeps exactly the text the other checks match, but never runs.
flow_is() {
  local ifs
  if printf '%s' "$2" | grep -qE '(^|[^A-Za-z0-9_])(for|while|loop|match)([^A-Za-z0-9_]|$)|[|]'; then
    violation "$1 has a loop, match or closure" || return 1
  fi
  ifs=$(printf '%s' "$2" | grep -oE "(^|[^A-Za-z0-9_])if[^A-Za-z0-9_{][^{]*[{]" | sed -E "s/^[^i]*if${S}//; s/${S}[{]$//" |
    tr '\n' ' ' | sed -E 's/ $//')
  [ "$ifs" = "$3" ] || violation "$1 branches on [$ifs], not exactly on the rule conditions [$3]"
}

# depth_at <text> <regex>: the brace depth where the regex first matches (unmatched: the depth at the end).
depth_at() {
  local prefix
  prefix=$(printf '%s' "$1" | sed -E "s/$2.*//")
  echo $(($(printf '%s' "$prefix" | tr -cd '{' | wc -c) - $(printf '%s' "$prefix" | tr -cd '}' | wc -c)))
}
