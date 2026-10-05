#!/usr/bin/env bash
# setup-noir.sh <stamp> — opens the Aztec.nr scan: runs dir, scope keys, source.md, name map, empty ledger copy.
set -euo pipefail
ST=$1 ROOT=.aztec-auditor
FILES=(
  ./contracts/aztec/token/src/main.nr
  ./contracts/aztec/token/src/hints.nr
  ./contracts/aztec/token_bridge/src/main.nr
  ./contracts/aztec/token_bridge/src/config.nr
  ./contracts/aztec/token_bridge/src/funding_address_note.nr
  ./contracts/aztec/token_minter_proxy/src/main.nr
  ./contracts/aztec/claim_secret/src/lib.nr
  ./contracts/aztec/merchant_stamp/src/lib.nr
  ./contracts/aztec/portal_messages/src/lib.nr
)
B=$(mktemp -d ./.audit-nr-XXXXXX)
mkdir -p "$ROOT/runs/$ST"
{
  printf '%s\t%s\n' name "inference-money (Aztec.nr)"
  printf '%s\t%s\n' mode "default"
  printf '%s\t%s\n' files "${FILES[*]}"
  printf '%s\t%s\n' passes_planned "3"
} > "$ROOT/runs/$ST/scope.tsv"
for f in "${FILES[@]}"; do
  printf '### %s\n\n```rust\n' "$f"
  cat "$f"
  printf '\n```\n\n'
done > "$B/source.md"
grep -ohE '(contract|struct|mod|trait)[[:space:]]+[A-Za-z0-9_]+|fn[[:space:]]+[A-Za-z0-9_]+' "$B/source.md" \
  | awk '{ n=$2; k=tolower(n); gsub(/[^a-z0-9]+/, "-", k); print k "\t" n }' | sort -u > "$B/source-names.tsv"
# Library crates are named by directory in findings, so map them too.
for c in claim_secret merchant_stamp portal_messages hints; do k=$(echo "$c" | tr '_' '-'); printf '%s\t%s\n' "$k" "$c"; done >> "$B/source-names.tsv"
sort -u -o "$B/source-names.tsv" "$B/source-names.tsv"
: > "$B/memory-before.tsv"
: > "$B/scan-rows.tsv"
printf '%s\t%s\n' mem_before "0" >> "$ROOT/runs/$ST/scope.tsv"
echo "bundle_dir=$B"
wc -l "$B/source.md" "$B/source-names.tsv"
