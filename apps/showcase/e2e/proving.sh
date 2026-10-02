#!/usr/bin/env bash
# The proving harness: the showcase proving for real in the browser on a local network, timed unconstrained and then
# under a 2-CPU cgroup quota. ports → net:up → deploy:local → demo setup → build (real proofs) → playwright twice →
# report → reap.
#
#   bun run test:proving
#
# Writes test-results/proving.json and prints the live-proving decision. Each Playwright run is its own systemd scope,
# so the quota binds the browser and every worker it proves in, and the scope's memory.peak covers them all.
set -euo pipefail
RUN_PREFIX=showcase-proving
# shellcheck source=run/common.sh
source "$(dirname "$0")/run/common.sh"
WEB_DIST="$STATE_DIR/dist"
# shellcheck disable=SC2317,SC2329  # invoked by the EXIT trap
reap() { reap_run $?; }
trap reap EXIT

systemd-run --user --scope --quiet true 2>/dev/null || fatal "the proving harness needs systemd-run --user --scope (cgroup v2)"

log "run $RUN_ID: claiming ports"
claim_ports web
WEB_PORT=$(port web)
boot_deployment
setup_demo
build_showcase real "$WEB_DIST"

# prove <label> [systemd-run property...]: one timed Playwright run in a scope of its own.
prove() {
  local label=$1
  shift
  log "proving, $label"
  systemd-run --user --scope --quiet "$@" -- env E2E_PROVING="$label" E2E_STATE_DIR="$STATE_DIR" BRIDGE_MANIFEST="$MANIFEST" \
    E2E_ANVIL_URL="$ANVIL_URL" E2E_WEB_PORT="$WEB_PORT" E2E_WEB_DIST="$WEB_DIST" \
    "$APP_DIR/node_modules/.bin/playwright" test --config e2e/playwright.config.ts
}
prove unconstrained
prove 2-cpu -p CPUQuota=200%

bun e2e/run/proving-report.ts "$STATE_DIR/proving" test-results/proving.json
