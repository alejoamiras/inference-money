#!/usr/bin/env bash
# record-pass.sh <root> <bundle_dir> <stamp> <pass> <agents> <rows.tsv> <sha>
# Appends a pass's gated rows, merges the ledger (solidity-auditor Turn 4 step 6), writes the mem_ keys.
set -euo pipefail
ROOT=$1 B=$2 ST=$3 K=$4 AG=$5 ROWS=$6 SHA=$7
printf '%s\t%s\n' "pass_${K}_agents" "$AG" >> "$ROOT/runs/$ST/scope.tsv"
cat "$ROWS" >> "$B/scan-rows.tsv"
awk -F'\t' -v OFS='\t' '
FILENAME==ARGV[1] {
  if (FNR==1) next
  o_st[$1]=$2; o_sc[$1]=$3; o_sha[$1]=$4; o_ti[$1]=$5; o_ki[$1]=$6
  if (!($1 in o_seen)) { o_seen[$1]=1; oord[++on]=$1 }
  next
}
{
  if (!($1 in n_seen)) { n_seen[$1]=1; nord[++nn]=$1 }
  n_sha[$1]=$2; n_ti[$1]=$3; n_ki[$1]=$4
}
END {
  print "#solidity-auditor-memory v1", "key", "status", "scans", "sha", "title", "kind"
  for (i=1; i<=on; i++) {
    k = oord[i]
    if (k in n_seen) print k, "KNOWN", o_sc[k]+1, n_sha[k], n_ti[k], n_ki[k]
    else             print k, o_st[k], o_sc[k], o_sha[k], o_ti[k], o_ki[k]
  }
  for (i=1; i<=nn; i++) {
    k = nord[i]
    if (!(k in o_seen)) print k, "NEW", 1, n_sha[k], n_ti[k], n_ki[k]
  }
}
' "$B/memory-before.tsv" "$B/scan-rows.tsv" > "$ROOT/memory.tsv.tmp"
mv "$ROOT/memory.tsv.tmp" "$ROOT/memory.tsv"
printf '%s\t%s\n' mem_after "$(( $(wc -l < "$ROOT/memory.tsv") - 1 ))" >> "$ROOT/runs/$ST/scope.tsv"
printf '%s\t%s\n' mem_sha "$SHA" >> "$ROOT/runs/$ST/scope.tsv"
echo "ledger $(( $(wc -l < "$ROOT/memory.tsv") - 1 )) records"
