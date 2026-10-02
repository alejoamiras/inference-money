#!/usr/bin/env bash
# The keyed-run checkout (docs/operations.md): a detached worktree that only this script moves, so later edits or pushes
# in the working checkout can't reach an approved run. env-exec runs in the checkout that filed the request and accepts
# any commit that is a branch tip on the remote, so `sync` also pushes the commit as keyed/testnet. The install skips
# every script: none may ever run with a keyed run's secrets in its environment.
#   sync    move the worktree to this checkout's HEAD (committed), push it as keyed/testnet, install without scripts
#   remove  delete the worktree and the remote branch
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
keyed="${KEYED_WORKTREE:-$HOME/.cache/inference-money/keyed}"
branch=keyed/testnet

fail() {
  echo "keyed-worktree: $*" >&2
  exit 1
}

sync() {
  [ -z "$(git -C "$repo" status --porcelain)" ] || fail "commit everything first: a keyed run executes committed code only"
  local head
  head=$(git -C "$repo" rev-parse HEAD)
  if [ -d "$keyed" ]; then
    [ -z "$(git -C "$keyed" status --porcelain)" ] || fail "$keyed has local changes"
    git -C "$keyed" checkout -q --detach "$head"
  else
    mkdir -p "$(dirname "$keyed")"
    git -C "$repo" worktree add -q --detach "$keyed" "$head"
  fi
  git -C "$repo" push -q --force origin "$head:refs/heads/$branch"
  (cd "$keyed" && bun install --frozen-lockfile --ignore-scripts)
  echo "keyed worktree $keyed at $head (origin/$branch)"
}

remove() {
  if [ -d "$keyed" ]; then
    git -C "$repo" worktree remove --force "$keyed"
  fi
  if git -C "$repo" ls-remote --exit-code --heads origin "$branch" >/dev/null; then
    git -C "$repo" push -q origin --delete "$branch"
  fi
  echo "keyed worktree removed"
}

case "${1:-}" in
  sync) sync ;;
  remove) remove ;;
  *)
    echo "usage: $0 sync|remove" >&2
    exit 2
    ;;
esac
