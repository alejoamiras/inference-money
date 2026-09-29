#!/usr/bin/env bash
# Runs the pinned aztec-nargo in a crate directory: scripts/nargo-5.sh <crate-dir> <nargo args...>
# Every local invocation goes through this wrapper. Note that a bare `nargo compile` overwrites a committed
# contract artifact with an untranspiled one; build contracts with compile.sh instead.
set -euo pipefail
# shellcheck source=toolchain.sh
source "$(dirname "${BASH_SOURCE[0]}")/toolchain.sh"
crate="$1"
shift
cd "$crate"
exec "$NARGO" "$@"
