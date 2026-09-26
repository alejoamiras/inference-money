#!/usr/bin/env bash
# Sourced by the Noir scripts: resolves the pinned aztec toolchain from toolchain.json. The crates pin aztec-nr at
# that tag; a newer default toolchain on PATH fails with a flood of macro errors (`cannot find self`).
aztec_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(cd "$aztec_root/../.." && pwd)"
NOIR_VERSION="$(jq -er .noir "$repo_root/toolchain.json")"
AZTEC_HOME="${AZTEC_HOME:-$HOME/.aztec/versions/$NOIR_VERSION}"
# 5.x exposes the bundled binaries as aztec-* in bin/; the `aztec` CLI and `bb` (the AVM transpiler) sit in
# node_modules/.bin.
NARGO="$AZTEC_HOME/bin/aztec-nargo"
AZTEC="$AZTEC_HOME/node_modules/.bin/aztec"
BB="$AZTEC_HOME/node_modules/.bin/bb"
for tool in "$NARGO" "$AZTEC" "$BB"; do
  [ -x "$tool" ] || {
    echo "$tool not found — run: aztec-up install $NOIR_VERSION" >&2
    exit 1
  }
done
PATH="$AZTEC_HOME/bin:$AZTEC_HOME/node_modules/.bin:$PATH"
export aztec_root repo_root NOIR_VERSION AZTEC_HOME NARGO AZTEC BB PATH
