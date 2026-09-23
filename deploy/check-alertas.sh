#!/usr/bin/env bash
# Cron wrapper for the closure alert check (SECURITY-CRITICAL).
# Calls the backend through its localhost-only port so CRON_SECRET never
# transits the public internet nor lands in nginx's access logs.
#
# Install on the server as <DEPLOY_DIR>/bin/check-alertas.sh (chmod 700) and
# invoke it under flock to prevent overlapping runs (the handler is NOT safe
# under concurrency):
#   */10 * * * * flock -n <DEPLOY_DIR>/check-alertas.lock \
#     <DEPLOY_DIR>/bin/check-alertas.sh >> <DEPLOY_DIR>/cron.log 2>&1
set -euo pipefail

# The script lives at <DEPLOY_DIR>/bin/check-alertas.sh, so its own location
# resolves the deploy directory without hardcoding a path.
DEPLOY_DIR="${DEPLOY_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
BACKEND_PORT="${BACKEND_PORT:-3101}"

source <(grep -E '^CRON_SECRET=' "$DEPLOY_DIR/.env")

curl -fsS --max-time 300 \
  "http://127.0.0.1:${BACKEND_PORT}/api/cron/check-alertas?secret=${CRON_SECRET}"
echo
