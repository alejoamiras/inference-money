#!/usr/bin/env bash
# Installs toolchain.json's Aztec node where the local network finds it through AZTEC_NODE_HOME, without aztec-up
# (unpinned remote scripts, an unlocked npm install): the node from toolchain/'s frozen lockfile, migrated from
# aztec-up's own npm lock so both run the same tree, and the Foundry release that node ships with, checked against
# its pinned digest. linux-x64 only.
#
#   bash packages/local-network/scripts/install-node.sh <dir> && export AZTEC_NODE_HOME=<dir>
set -euo pipefail

dest=${1:?usage: install-node.sh <dir>}
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo="$(cd "$here/../.." && pwd)"
node_version="$(jq -er .aztecNode "$repo/toolchain.json")"
foundry="$(jq -er .aztecNodeFoundry "$repo/toolchain.json")"
pins="$here/toolchain/foundry-$foundry.sha256"
[ -f "$pins" ] || {
  echo "no digest pinned for foundry $foundry ($pins)" >&2
  exit 1
}

(cd "$here/toolchain" && bun install --frozen-lockfile)
installed="$(jq -er .version "$here/toolchain/node_modules/@aztec/aztec/package.json")"
[ "$installed" = "$node_version" ] || {
  echo "toolchain/ locks aztec $installed, toolchain.json says $node_version" >&2
  exit 1
}

asset="foundry_v${foundry}_linux_amd64.tar.gz"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "https://github.com/foundry-rs/foundry/releases/download/v$foundry/$asset" -o "$tmp/$asset"
(cd "$tmp" && grep -v '^#' "$pins" | sha256sum -c -)
mkdir -p "$dest/internal-bin"
tar -xzf "$tmp/$asset" -C "$dest/internal-bin" anvil forge
ln -sfn "$here/toolchain/node_modules" "$dest/node_modules"
echo "aztec $node_version + foundry $foundry at $dest"
