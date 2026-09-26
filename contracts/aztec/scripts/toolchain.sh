#!/usr/bin/env bash
# Sourced by the Noir scripts: resolves the pinned toolchain from toolchain.json. The crates pin aztec-nr at `noir`;
# any other nargo fails with a flood of macro errors (`cannot find self`).
aztec_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(cd "$aztec_root/../.." && pwd)"
NOIR_VERSION="$(jq -er .noir "$repo_root/toolchain.json")"
NARGO_VERSION="$(jq -er .nargo "$repo_root/toolchain.json")"
# CI sets NARGO to the sha-pinned noir-lang release; locally it is the aztec-up install of the same version.
NARGO="${NARGO:-$HOME/.aztec/versions/$NOIR_VERSION/bin/aztec-nargo}"
[ -x "$NARGO" ] || {
  echo "$NARGO not found — run: aztec-up install $NOIR_VERSION" >&2
  exit 1
}
"$NARGO" --version | grep -qx "nargo version = $NARGO_VERSION" || {
  echo "$NARGO is not nargo $NARGO_VERSION (toolchain.json)" >&2
  exit 1
}
# The aztec CLI, bb and the TXE server come from this committed lockfile, never from an unlocked npm install.
TOOLCHAIN_DIR="$aztec_root/toolchain"
if [ ! -x "$TOOLCHAIN_DIR/node_modules/.bin/aztec" ]; then
  (cd "$TOOLCHAIN_DIR" && bun install --frozen-lockfile >/dev/null) || {
    echo "toolchain install failed — run: (cd $TOOLCHAIN_DIR && bun install --frozen-lockfile)" >&2
    exit 1
  }
fi
AZTEC="$TOOLCHAIN_DIR/node_modules/.bin/aztec"
BB="$TOOLCHAIN_DIR/node_modules/.bin/bb"
export aztec_root repo_root NOIR_VERSION NARGO_VERSION NARGO TOOLCHAIN_DIR AZTEC BB
