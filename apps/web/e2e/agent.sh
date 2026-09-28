#!/usr/bin/env bash
# The web browser suite; one run = one local network: ports → net:up → deploy:local → app + wallet builds → bundle
# assertions → sidecar → playwright → reap. Parallelism is `--shard=i/n` across separate runs.
#
#   bun run test:e2e [-- <playwright args, e.g. connect.spec.ts or --shard=1/2>]
#
# E2E_KEEP=1 leaves the network, the sidecar and the builds up and prints how to stop them. Every process this
# script starts is its own process group, and the trap stops exactly those groups.
set -euo pipefail

cd "$(dirname "$0")/.."
APP_DIR=$(pwd)
REPO=$(cd ../.. && pwd)
RUN_ID="web-e2e-$$-$(date +%s | tail -c 6)"
export RUN_ID
STATE_DIR="$HOME/.cache/inference-money/e2e/$RUN_ID"
WEB_DIST="$STATE_DIR/web-dist"
WALLET_DIST="$STATE_DIR/wallet-dist"
RESOLVED=""
SIDECAR_PGID=""
SIDECAR_START=""
NET_STARTED=0
mkdir -p "$STATE_DIR"

log() { echo "[e2e] $*"; }
fatal() { log "FATAL: $*"; exit 2; }

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
  if [ "$NET_STARTED" = 1 ]; then (cd "$REPO" && bun run net:down) || log "net:down failed; run RUN_ID=$RUN_ID bun run net:down"; fi
  if [ -n "$RESOLVED" ]; then
    rm -rf "$REPO/deployments/local/$RESOLVED" "$HOME/.cache/inference-money/forge/$RESOLVED"
    bun e2e/run/resolve-ports.ts release "$RESOLVED" || true
  fi
  # A failed run keeps its builds, logs and traces for inspection; a passing one leaves nothing.
  if [ "$status" = 0 ]; then rm -rf "$STATE_DIR"; else log "state kept for inspection: $STATE_DIR"; fi
}
trap reap EXIT

log "run $RUN_ID: claiming ports"
bun e2e/run/resolve-ports.ts claim "$STATE_DIR" "$$"
port() { jq -er ".$1" "$STATE_DIR/ports.json"; }
# The tag namespaced by this checkout: what net:up, deploy:local and the port registry key on.
RESOLVED=$(port runId)
MANIFEST="$REPO/deployments/local/$RESOLVED/manifest.json"
NET_HANDLE="$HOME/.cache/inference-money/net/$RESOLVED.json"
E2E_WEB_PORT=$(port web)
E2E_WALLET_PORT_MAIN=$(port walletMain)
E2E_WALLET_PORT_SOLO=$(port walletSolo)
E2E_WALLET_PORT_LATE=$(port walletLate)
SIDECAR_PORT=$(port sidecar)
WEB_ORIGIN="http://127.0.0.1:$E2E_WEB_PORT"
WALLET_URLS="http://127.0.0.1:$E2E_WALLET_PORT_MAIN/?profile=main,http://127.0.0.1:$E2E_WALLET_PORT_SOLO/?profile=solo,http://127.0.0.1:$E2E_WALLET_PORT_LATE/?profile=late"

log "booting the local network"
NET_STARTED=1
(cd "$REPO" && bun run net:up) >"$STATE_DIR/net.log" 2>&1 || { tail -40 "$STATE_DIR/net.log" >&2; fatal "net:up failed (log: $STATE_DIR/net.log)"; }
E2E_ANVIL_URL=$(jq -er .anvilUrl "$NET_HANDLE")

log "deploying the bridge"
(cd "$REPO" && bun run deploy:local) >"$STATE_DIR/deploy.log" 2>&1 || { tail -40 "$STATE_DIR/deploy.log" >&2; fatal "deploy:local failed"; }
NODE_URL=$(jq -er .l2.nodeUrl "$MANIFEST")

log "building the app → $WEB_DIST"
BRIDGE_MANIFEST="$MANIFEST" WEB_WALLET_URLS="$WALLET_URLS" ./node_modules/.bin/vite build --outDir "$WEB_DIST" --emptyOutDir \
  >"$STATE_DIR/build-web.log" 2>&1 || { tail -40 "$STATE_DIR/build-web.log" >&2; fatal "app build failed"; }
grep -rqF -- "$NODE_URL" "$WEB_DIST/assets" || fatal "the app bundle does not name the node $NODE_URL"
for url in ${WALLET_URLS//,/ }; do
  grep -rqF -- "$url" "$WEB_DIST/assets" || fatal "the app bundle does not list the test wallet $url"
done

log "building the test wallet → $WALLET_DIST"
BRIDGE_MANIFEST="$MANIFEST" WEB_ORIGIN="$WEB_ORIGIN" TEST_WALLET_OUT_DIR="$WALLET_DIST" \
  ./node_modules/.bin/vite build --config e2e/test-wallet/vite.config.ts >"$STATE_DIR/build-wallet.log" 2>&1 \
  || { tail -40 "$STATE_DIR/build-wallet.log" >&2; fatal "test wallet build failed"; }
grep -rqF -- "$NODE_URL" "$WALLET_DIST/assets" || fatal "the wallet bundle does not name the node $NODE_URL"

log "starting the sidecar on :$SIDECAR_PORT"
SIDECAR_PORT="$SIDECAR_PORT" setsid bun e2e/run/sidecar.ts >"$STATE_DIR/sidecar.log" 2>&1 &
SIDECAR_PGID=$!
SIDECAR_START=$(ps -o lstart= -p "$SIDECAR_PGID")
E2E_SIDECAR_URL="http://127.0.0.1:$SIDECAR_PORT"
for _ in $(seq 1 300); do
  curl -sf "$E2E_SIDECAR_URL/health" >/dev/null && break
  owns_sidecar || { tail -40 "$STATE_DIR/sidecar.log" >&2; fatal "the sidecar died while starting"; }
  sleep 1
done
curl -sf "$E2E_SIDECAR_URL/health" >/dev/null || fatal "the sidecar did not come up in 5 min"

log "running playwright ($*)"
set +e
E2E_STATE_DIR="$STATE_DIR" BRIDGE_MANIFEST="$MANIFEST" E2E_ANVIL_URL="$E2E_ANVIL_URL" E2E_SIDECAR_URL="$E2E_SIDECAR_URL" \
E2E_WEB_PORT="$E2E_WEB_PORT" E2E_WEB_DIST="$WEB_DIST" E2E_WALLET_DIST="$WALLET_DIST" \
E2E_WALLET_PORT_MAIN="$E2E_WALLET_PORT_MAIN" E2E_WALLET_PORT_SOLO="$E2E_WALLET_PORT_SOLO" E2E_WALLET_PORT_LATE="$E2E_WALLET_PORT_LATE" \
  "$APP_DIR/node_modules/.bin/playwright" test --config e2e/playwright.config.ts "$@"
STATUS=$?
set -e
log "playwright exit $STATUS"
exit $STATUS
