#!/usr/bin/env bash
# build-bundles.sh <ledger.tsv|-> <bundle_dir> <refs_dir> [overlay.md]
# Rebuilds known-findings.md from a ledger (Turn 2 step 2c) and re-cats the 12 bundles (Turn 2 step 3).
# Specialty files are read from <refs_dir>/hacking-agents/; an optional overlay is appended after shared-rules.md.
set -euo pipefail
LEDGER=$1 B=$2 R=$3 OVERLAY=${4:-}
rm -f "$B/known-findings.md"
if [ "$LEDGER" != "-" ] && [ -s "$LEDGER" ]; then
  awk -F'\t' '
  FILENAME==ARGV[1] { nm[$1]=$2; next }
  FNR==1 { next }
  {
    split($1, p, "|")
    c = (p[1] in nm) ? nm[p[1]] : p[1]
    f = (p[2] in nm) ? nm[p[2]] : p[2]
    h = c "." f
    if (!(h in seen)) { seen[h]=1; ord[++n]=h }
    body[h] = body[h] "- `" p[3] "` — " $6 ", seen in " $3 ($3==1 ? " scan" : " scans") " — " $5 "\n"
  }
  END { for (i=1; i<=n; i++) printf "## %s\n\n%s\n", ord[i], body[ord[i]] }
  ' "$B/source-names.tsv" "$LEDGER" > "$B/known-findings.body.md"
  if [ -s "$B/known-findings.body.md" ]; then
    cat "$(dirname "$0")/known-findings-head.md" "$B/known-findings.body.md" > "$B/known-findings.md"
  fi
  rm -f "$B/known-findings.body.md"
fi
i=0
for a in math-precision access-control economic-security execution-trace invariant periphery first-principles asymmetry boundary numerical-gap trust-gap flow-gap; do
  i=$((i+1))
  parts=("$B/source.md" "$R/senior-auditor-sop.md" "$R/hacking-agents/$a-agent.md" "$R/hacking-agents/shared-rules.md")
  [ -n "$OVERLAY" ] && parts+=("$OVERLAY")
  parts+=("$R/report-language.md")
  [ -f "$B/known-findings.md" ] && parts+=("$B/known-findings.md")
  cat "${parts[@]}" > "$B/agent-$i-bundle.md"
done
wc -l "$B"/agent-*-bundle.md | sort -V -k2 | awk '{print $2": "$1}'
[ -f "$B/known-findings.md" ] && echo "known-findings: $(grep -c '^- `' "$B/known-findings.md") records" || echo "known-findings: none"
