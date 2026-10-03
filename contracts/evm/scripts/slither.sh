#!/usr/bin/env bash
# Slither over src/, failing on any finding that slither.config.json or an inline, reasoned suppression does not cover.
# It reads a build of its own: left to compile, its foundry mode runs `forge clean` on the shared out/, and a shared
# cache would race a concurrent forge run.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
mkdir -p "$HOME/.cache/inference-money/forge"
dir=$(mktemp -d "$HOME/.cache/inference-money/forge/slither-XXXXXX")
trap 'rm -rf "$dir"' EXIT
forge build src --out "$dir/out" --cache-path "$dir/cache" --force --build-info >/dev/null
slither . --config-file slither.config.json --foundry-ignore-compile --foundry-out-directory "$dir/out" --fail-pedantic
