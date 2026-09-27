#!/usr/bin/env bash
# Compiles + AVM-transpiles the deployable contracts into <crate>/target/*.json.
# `aztec compile` is nargo + transpile + VKs; a plain `nargo compile` artifact is rejected by aztec.js
# ("public bytecode has not been transpiled").
#
#   compile.sh            rebuild every contract crate's artifact in place
#   compile.sh --check    rebuild, then require each HEAD-committed artifact's identity (class id + SDK-facing ABI,
#                         see artifact-identity.ts) to equal the fresh build's. The working-tree artifacts are
#                         restored either way, so the check never dirties the tree. Exit 1 on any drift.
#   compile.sh [--check] <crate>...   restrict to the named crates
set -euo pipefail
# shellcheck source=toolchain.sh
source "$(dirname "${BASH_SOURCE[0]}")/toolchain.sh"
# nargo builds from whatever ~/nargo holds, or clones a mutable tag: the deployable bytes need the pinned commits.
bash "$(dirname "${BASH_SOURCE[0]}")/noir-deps.sh"

identity() { (cd "$aztec_root" && bun scripts/artifact-identity.ts "$@"); }

check=0
crates=()
for arg in "$@"; do
  case "$arg" in
    --check) check=1 ;;
    *) crates+=("$arg") ;;
  esac
done
# Dependency order: token_bridge imports token_minter_proxy's interface.
[ ${#crates[@]} -gt 0 ] || crates=(token_minter_proxy token_bridge)

compare_tracked() {
  local c="$1" baseline="$2" tracked="$3" name
  [ -n "$tracked" ] || {
    echo "✖ $c: no committed artifact to compare against" >&2
    return 1
  }
  for name in $tracked; do
    if [ ! -f "$aztec_root/$c/target/$name" ]; then
      echo "✖ $c: the source no longer produces $name" >&2
      return 1
    fi
    if identity compare "$baseline/$name" "$aztec_root/$c/target/$name"; then
      echo "✔ $c: $name matches its source (class id $(identity "$baseline/$name" | jq -r .classId))"
    else
      echo "✖ $c: $name drifted from its source" >&2
      return 1
    fi
  done
}

restore() {
  rm -f "$aztec_root/$1"/target/*.json
  mv -f "$2"/*.json "$aztec_root/$1"/target/ 2>/dev/null || true
  rm -rf "$2"
}

drift=0
for c in "${crates[@]}"; do
  grep -qE '^type *= *"contract"' "$aztec_root/$c/Nargo.toml" || {
    echo "$c is not a contract crate" >&2
    exit 2
  }
  echo "=== aztec compile $c ==="
  mkdir -p "$aztec_root/$c/target"
  # `aztec compile` skips the build unless a source is newer than the OLDEST target/*.json (target/ also holds
  # ignored staged artifacts), so every JSON is cleared to force it. --check sets them aside for restoring and
  # compares against HEAD, so an uncommitted artifact edit can neither mask nor fake drift.
  if [ "$check" = 1 ]; then
    stash="$(mktemp -d)"
    baseline="$(mktemp -d)"
    rel="${aztec_root#"$repo_root"/}/$c/target"
    tracked="$(git -C "$repo_root" ls-tree --name-only HEAD -- "$rel/" | grep '\.json$' | xargs -r -n1 basename)"
    for name in $tracked; do
      git -C "$repo_root" show "HEAD:$rel/$name" >"$baseline/$name"
    done
    mv "$aztec_root/$c"/target/*.json "$stash/" 2>/dev/null || true
    trap 'restore "$c" "$stash"; rm -rf "$baseline"' EXIT
  else
    rm -f "$aztec_root/$c"/target/*.json
  fi
  (cd "$aztec_root/$c" && "$AZTEC" compile)
  # The debug file_map embeds absolute source paths (repo root, ~/.aztec, ~/nargo); the artifact is committed, so
  # rewrite them repo-relative: no home-dir layout leaks and the bytes are machine-independent.
  LC_ALL=C perl -i -pe "s{\Q$repo_root\E/}{}g; s{\Q$HOME\E/}{}g" "$aztec_root/$c"/target/*.json
  if [ "$check" = 1 ]; then
    compare_tracked "$c" "$baseline" "$tracked" || drift=1
    restore "$c" "$stash"
    rm -rf "$baseline"
    trap - EXIT
  fi
done
if [ "$check" = 1 ]; then
  [ "$drift" = 0 ] || exit 1
  echo "✅ committed artifacts match their sources (class id + ABI)"
else
  echo "✅ transpiled + path-scrubbed artifacts in */target/*.json"
fi
