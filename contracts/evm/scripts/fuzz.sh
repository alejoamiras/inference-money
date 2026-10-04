#!/usr/bin/env bash
# A bounded Medusa campaign over test/fizz: `fuzz.sh [seconds]` (default 3600).
# Fails on a broken property, on any Medusa error, and on a campaign that registered fewer of the suite's
# public property_* checks than Properties.sol declares (Medusa's stopOnNoTests only catches an empty test list).
set -euo pipefail
cd "$(dirname "$0")/.."

seconds="${1:-3600}"
log=fizz_data/last-campaign.log
mkdir -p fizz_data

# medusa.json's testLimit bounds local runs; here the timeout alone ends the campaign. pipefail makes `status`
# Medusa's exit (or tee's), and the foreground pipeline has finished writing the log before it is parsed.
status=0
FOUNDRY_PROFILE=fuzz medusa fuzz --config medusa.json --timeout "$seconds" --test-limit 0 2>&1 | tee "$log" ||
	status=$?
echo "fuzz: the campaign ran ${SECONDS}s"

plain="$(sed 's/\x1b\[[0-9;]*m//g' "$log")"
declared=$(grep -cE '^\s*function property_[A-Za-z0-9_]+\(\) public' test/fizz/Properties.sol)
registered=$(grep -oE 'Assertion Test: FuzzTester\.property_[A-Za-z0-9_]+\(\)' <<<"$plain" | sort -u | wc -l)
if ((registered < declared)); then
	echo "fuzz: Medusa registered $registered of $declared property_* checks" >&2
	exit 1
fi
if ((status != 0)); then
	echo "fuzz: Medusa exited $status" >&2
	grep -E 'FAILED|Test summary' <<<"$plain" >&2 || true
	exit "$status"
fi
grep -E 'Test summary' <<<"$plain"
