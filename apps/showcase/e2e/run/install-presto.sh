#!/usr/bin/env bash
# Installs toolchain.json's presto-server, the headless Presto that browser runs prove through, after checking the
# release against its pinned digest. linux-x64 only. Prints the binary's path.
#
#   bin=$(bash apps/showcase/e2e/run/install-presto.sh)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../../../.." && pwd)"
version="$(jq -er .prestoServer "$repo/toolchain.json")"
pins="$here/presto-server-$version.sha256"
[ -f "$pins" ] || {
  echo "no digest pinned for presto-server $version ($pins)" >&2
  exit 1
}
root="$HOME/.cache/inference-money/presto-server"
dest="$root/$version"
mkdir -p "$root"
# Runs share the cache: one installs while the others wait, and the rename publishes the binary whole.
exec 9>"$root/.lock"
flock 9
if [ ! -x "$dest/presto-server" ]; then
  asset="presto-server-$version-linux-x86_64.tar.gz"
  tmp="$(mktemp -d "$root/.install-XXXXXX")"
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL "https://github.com/alejoamiras/presto/releases/download/presto-v$version/$asset" -o "$tmp/$asset"
  (cd "$tmp" && grep -v '^#' "$pins" | sha256sum -c - >/dev/null)
  mkdir "$tmp/bin"
  tar -xzf "$tmp/$asset" -C "$tmp/bin" presto-server
  rm -rf "$dest"
  mv "$tmp/bin" "$dest"
fi
echo "$dest/presto-server"
