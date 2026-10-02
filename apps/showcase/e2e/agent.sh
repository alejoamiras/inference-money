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
SIDECAR_MARKER="sidecar-$RUN_ID"

owns_sidecar() { owns_group "$SIDECAR_PGID" "$SIDECAR_START" "$SIDECAR_MARKER"; }

# shellcheck disable=SC2317,SC2329  # invoked from reap, which the EXIT trap runs
stop_sidecar() {
  [ -n "$SIDECAR_PGID" ] || return 0
  stop_group "$SIDECAR_PGID" "$SIDECAR_START" "$SIDECAR_MARKER"
  # Its wallet stores live in its own pid's dir, which a killed sidecar leaves behind and `secrets:scan` fails on. The
  # dir goes once the whole group has exited; a group still standing, ours or a reuse of its id, keeps it.
  for _ in $(seq 1 5); do kill -0 -- "-$SIDECAR_PGID" 2>/dev/null || break; sleep 1; done
  if kill -0 -- "-$SIDECAR_PGID" 2>/dev/null; then
    log "sidecar group $SIDECAR_PGID still runs; its wallet dir stays for the next wallet run's reaper"
  else
    rm -rf "$HOME/.cache/inference-money/wallet-tmp/$SIDECAR_PGID"
  fi
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
INFERENCE_MONEY_OWNER="$SIDECAR_MARKER" SIDECAR_PORT="$SIDECAR_PORT" setsid bun e2e/run/sidecar.ts >"$STATE_DIR/sidecar.log" 2>&1 &
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
