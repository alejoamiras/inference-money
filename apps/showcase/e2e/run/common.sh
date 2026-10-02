#!/usr/bin/env bash
# Shared by the showcase's browser runs (e2e/agent.sh, e2e/proving.sh, e2e/presto.sh): sourced after `set -euo pipefail` with
# RUN_PREFIX set. One run owns one local network, deployment and demo cast; `reap_run` removes exactly those.
# shellcheck disable=SC2034  # APP_DIR, ANVIL_URL and NODE_URL are read by the scripts that source this

cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2
APP_DIR=$(pwd)
REPO=$(cd ../.. && pwd)
RUN_ID="$RUN_PREFIX-$$-$(date +%s | tail -c 6)"
export RUN_ID
STATE_DIR="$HOME/.cache/inference-money/e2e/$RUN_ID"
RESOLVED=""
MANIFEST=""
NET_STARTED=0
mkdir -p "$STATE_DIR"

log() { echo "[$RUN_PREFIX] $*"; }
fatal() { log "FATAL: $*"; exit 2; }
port() { jq -er ".$1" "$STATE_DIR/ports.json"; }

# step <name> <command...>: runs it with its output in $STATE_DIR/<name>.log; a failure shows the log's tail and stops.
step() {
  local name=$1
  shift
  "$@" >"$STATE_DIR/$name.log" 2>&1 || { tail -40 "$STATE_DIR/$name.log" >&2; fatal "$name failed (log: $STATE_DIR/$name.log)"; }
}

# owns_group <pgid> <start> <marker>: a pid alone is not ownership, since the kernel recycles pids. The group leader's
# start time must still be the one recorded at spawn; once the leader is gone, a member carrying the marker in its
# environment proves it (Linux /proc only).
owns_group() {
  local pgid=$1 start=$2 marker=$3 pid
  [ -n "$pgid" ] || return 1
  [ "$(ps -o lstart= -p "$pgid" 2>/dev/null)" = "$start" ] && return 0
  for pid in $(pgrep -g "$pgid" 2>/dev/null); do
    tr '\0' '\n' <"/proc/$pid/environ" 2>/dev/null | grep -qx "INFERENCE_MONEY_OWNER=$marker" && return 0
  done
  return 1
}

# stop_group <pgid> <start> <marker>: TERM, then KILL after 20 s, each only while this run still owns the group.
stop_group() {
  local pgid=$1 start=$2 marker=$3
  [ -n "$pgid" ] || return 0
  owns_group "$pgid" "$start" "$marker" || return 0
  kill -TERM -- "-$pgid" 2>/dev/null || true
  for _ in $(seq 1 20); do owns_group "$pgid" "$start" "$marker" || return 0; sleep 1; done
  owns_group "$pgid" "$start" "$marker" && kill -KILL -- "-$pgid" 2>/dev/null || true
}

# claim_ports <service>...: also resolves the tag namespaced by this checkout, which net:up, deploy:local and the port
# registry key on.
claim_ports() {
  bun e2e/run/resolve-ports.ts claim "$STATE_DIR" "$$" "$@"
  RESOLVED=$(port runId)
  MANIFEST="$REPO/deployments/local/$RESOLVED/manifest.json"
}

boot_deployment() {
  log "booting the local network"
  NET_STARTED=1
  step net bun run --cwd "$REPO" net:up
  ANVIL_URL=$(jq -er .anvilUrl "$HOME/.cache/inference-money/net/$RESOLVED.json")
  log "deploying the bridge"
  step deploy bun run --cwd "$REPO" deploy:local
  NODE_URL=$(jq -er .l2.nodeUrl "$MANIFEST")
}

setup_demo() {
  log "setting up the demo cast"
  step demo bun run --cwd "$REPO" bridge demo setup local
}

# build_showcase <real|fake> <out-dir>: this run's bundle, checked for its node and for banned modules.
build_showcase() {
  log "building the showcase ($1 proofs) → $2"
  step build env BRIDGE_MANIFEST="$MANIFEST" SHOWCASE_PROOFS="$1" ./node_modules/.bin/vite build --outDir "$2" --emptyOutDir
  grep -rqF -- "$NODE_URL" "$2/assets" || fatal "the bundle does not name the node $NODE_URL"
  step bundle env BUILT_DIST="$2" ./node_modules/.bin/vitest run build/bundle.test.ts
}

# reap_run <exit status>: the network, the deployment and its demo state, the ports; the run's state too if it passed.
reap_run() {
  local status=$1 bridge=""
  if [ "$NET_STARTED" = 1 ]; then bun run --cwd "$REPO" net:down || log "net:down failed; run RUN_ID=$RUN_ID bun run net:down"; fi
  if [ -n "$RESOLVED" ]; then
    [ -f "$MANIFEST" ] && bridge=$(jq -r .l2.bridge.address "$MANIFEST")
    [ -n "$bridge" ] && rm -rf "$HOME/.cache/inference-money/demo/$bridge"
    rm -rf "$REPO/deployments/local/$RESOLVED" "$HOME/.cache/inference-money/forge/$RESOLVED"
    bun e2e/run/resolve-ports.ts release "$RESOLVED" || true
  fi
  # A failed run keeps its builds, logs and traces for inspection; a passing one leaves nothing.
  if [ "$status" = 0 ]; then rm -rf "$STATE_DIR"; else log "state kept for inspection: $STATE_DIR"; fi
}
