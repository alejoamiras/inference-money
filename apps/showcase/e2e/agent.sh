#!/usr/bin/env bash
# The showcase's browser suite; one run = one local network: ports → net:up → deploy:local → heartbeat sidecar → demo
# setup → build + bundle assertions → playwright → reap. Parallelism is `--shard=i/n` across separate runs.
#
#   bun run test:e2e [-- <playwright args, e.g. tour.spec.ts or --shard=1/2>]
#
# E2E_KEEP=1 leaves the network, the sidecar and the build up and prints how to stop them. Every process this script
# starts is its own process group, and the trap stops exactly those groups.
set -euo pipefail
RUN_PREFIX=showcase-e2e
# shellcheck source=run/common.sh
source "$(dirname "$0")/run/common.sh"
WEB_DIST="$STATE_DIR/dist"
SIDECAR_PGID=""
SIDECAR_START=""

# A pid alone is not ownership: the kernel recycles pids, so the group leader's start time must still be the one
# recorded at spawn.
owns_sidecar() {
  [ -n "$SIDECAR_PGID" ] && [ "$(ps -o lstart= -p "$SIDECAR_PGID" 2>/dev/null)" = "$SIDECAR_START" ]
}

# shellcheck disable=SC2317,SC2329  # invoked from reap, which the EXIT trap runs
stop_sidecar() {
  owns_sidecar || return 0
  kill -TERM -- "-$SIDECAR_PGID" 2>/dev/null || true
  for _ in $(seq 1 20); do owns_sidecar || return 0; sleep 1; done
  if owns_sidecar; then kill -KILL -- "-$SIDECAR_PGID" 2>/dev/null || true; fi
}

# shellcheck disable=SC2317,SC2329  # invoked by the EXIT trap
reap() {
  local status=$?
  if [ "${E2E_KEEP:-}" = "1" ]; then
    log "kept $RUN_ID (state: $STATE_DIR). Stop with: kill -TERM -- -$SIDECAR_PGID; RUN_ID=$RUN_ID bun run net:down; bun e2e/run/resolve-ports.ts release $RESOLVED"
    return
  fi
  stop_sidecar
  reap_run "$status"
}
trap reap EXIT

log "run $RUN_ID: claiming ports"
claim_ports web sidecar
WEB_PORT=$(port web)
SIDECAR_PORT=$(port sidecar)
boot_deployment

log "starting the sidecar on :$SIDECAR_PORT"
SIDECAR_PORT="$SIDECAR_PORT" setsid bun e2e/run/sidecar.ts >"$STATE_DIR/sidecar.log" 2>&1 &
SIDECAR_PGID=$!
SIDECAR_START=$(ps -o lstart= -p "$SIDECAR_PGID")
SIDECAR_URL="http://127.0.0.1:$SIDECAR_PORT"
for _ in $(seq 1 300); do
  curl -sf "$SIDECAR_URL/health" >/dev/null && break
  owns_sidecar || { tail -40 "$STATE_DIR/sidecar.log" >&2; fatal "the sidecar died while starting"; }
  sleep 1
done
curl -sf "$SIDECAR_URL/health" >/dev/null || fatal "the sidecar did not come up in 5 min"

setup_demo
build_showcase fake "$WEB_DIST"

log "running playwright ($*)"
set +e
E2E_STATE_DIR="$STATE_DIR" BRIDGE_MANIFEST="$MANIFEST" E2E_ANVIL_URL="$ANVIL_URL" \
E2E_WEB_PORT="$WEB_PORT" E2E_WEB_DIST="$WEB_DIST" \
  "$APP_DIR/node_modules/.bin/playwright" test --config e2e/playwright.config.ts "$@"
STATUS=$?
set -e
log "playwright exit $STATUS"
exit $STATUS
