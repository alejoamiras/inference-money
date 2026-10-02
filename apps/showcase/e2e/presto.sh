#!/usr/bin/env bash
# The showcase proving through Presto: a headless presto-server on a local network. ports → presto-server install →
# net:up → deploy:local → demo setup → build (real proofs, this run's Presto ports) → certificate → presto-server →
# playwright's presto project → reap.
#
#   bun run test:e2e:presto [-- <playwright args, e.g. presto-infra.spec.ts>]
#
# presto-server speaks HTTP only and the browser SDK proves over HTTPS only, so each spec runs an HTTPS proxy in front
# of it, with a certificate made for this run that only this run's browser trusts.
set -euo pipefail
# CI's job token is presto-server's alone (see its launch): un-exported, so nothing else this run starts inherits it.
export -n PRESTO_GITHUB_TOKEN
RUN_PREFIX=showcase-presto
# shellcheck source=run/common.sh
source "$(dirname "$0")/run/common.sh"
WEB_DIST="$STATE_DIR/dist"
# Outside $STATE_DIR, which CI uploads when a run fails: a private key, and Presto's downloaded prover.
TLS_DIR="$HOME/.cache/inference-money/presto-tls/$RUN_ID"
PRESTO_HOME_DIR="$HOME/.cache/inference-money/presto-home/$RUN_ID"
PRESTO_PGID=""
PRESTO_START=""
PRESTO_MARKER="presto-$RUN_ID"

# shellcheck disable=SC2317,SC2329  # invoked by the EXIT trap
reap() {
  local status=$?
  stop_group "$PRESTO_PGID" "$PRESTO_START" "$PRESTO_MARKER"
  rm -rf "$TLS_DIR" "$PRESTO_HOME_DIR"
  reap_run "$status"
}
trap reap EXIT

log "run $RUN_ID: claiming ports"
claim_ports web presto prestoTls
WEB_PORT=$(port web)
# presto-server's own (HTTP) port, and the HTTPS proxy's: the bundle knows both, like the app's 59833 and 59834.
export PRESTO_PORT PRESTO_HTTPS_PORT
PRESTO_PORT=$(port presto)
PRESTO_HTTPS_PORT=$(port prestoTls)
PRESTO_BIN=$(bash "$APP_DIR/e2e/run/install-presto.sh")
boot_deployment
setup_demo
build_showcase real "$WEB_DIST"

mkdir -p "$TLS_DIR" "$PRESTO_HOME_DIR"
chmod 700 "$TLS_DIR"
step tls openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 1 -subj "/CN=127.0.0.1" \
  -addext "subjectAltName=IP:127.0.0.1" -keyout "$TLS_DIR/key.pem" -out "$TLS_DIR/cert.pem"

# It ignores an unknown flag and serves on its default port, so it gets no flags at all: only this run's home and port.
# It checks the bb it downloads through the GitHub API, whose anonymous quota CI's shared addresses exhaust: CI passes
# its job token, exported in this subshell only, so it never appears on a command line.
log "starting presto-server on :$PRESTO_PORT"
(
  export INFERENCE_MONEY_OWNER="$PRESTO_MARKER" PRESTO_HOME="$PRESTO_HOME_DIR" ALLOWED_ORIGINS="http://127.0.0.1:$WEB_PORT"
  [ -z "${PRESTO_GITHUB_TOKEN:-}" ] || export GITHUB_TOKEN="$PRESTO_GITHUB_TOKEN"
  exec setsid "$PRESTO_BIN"
) >"$STATE_DIR/presto-server.log" 2>&1 &
PRESTO_PGID=$!
PRESTO_START=$(ps -o lstart= -p "$PRESTO_PGID")
log "presto-server: pgid $PRESTO_PGID"
for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:$PRESTO_PORT/health" >/dev/null && break
  owns_group "$PRESTO_PGID" "$PRESTO_START" "$PRESTO_MARKER" || {
    tail -40 "$STATE_DIR/presto-server.log" >&2
    fatal "presto-server died while starting"
  }
  sleep 1
done
curl -sf "http://127.0.0.1:$PRESTO_PORT/health" >/dev/null || fatal "presto-server did not come up in 60 s"

log "running playwright ($*)"
set +e
E2E_STATE_DIR="$STATE_DIR" BRIDGE_MANIFEST="$MANIFEST" E2E_ANVIL_URL="$ANVIL_URL" \
E2E_WEB_PORT="$WEB_PORT" E2E_WEB_DIST="$WEB_DIST" \
E2E_PRESTO_PORT="$PRESTO_PORT" E2E_PRESTO_TLS_PORT="$PRESTO_HTTPS_PORT" E2E_PRESTO_TLS_DIR="$TLS_DIR" \
  "$APP_DIR/node_modules/.bin/playwright" test --config e2e/playwright.config.ts "$@"
STATUS=$?
set -e
log "playwright exit $STATUS"
exit $STATUS
