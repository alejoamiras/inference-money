#!/usr/bin/env bash
# The fork suite skips itself without an RPC, so the gate refuses to run without one rather than pass on skips.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${SEPOLIA_RPC_URL:?SEPOLIA_RPC_URL must be set, or every fork test skips}"
forge test --match-contract Fork
