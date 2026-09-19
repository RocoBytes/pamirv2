#!/usr/bin/env bash
# Wrapper de cron para el chequeo de alarmas de cierre (CRÍTICO de seguridad).
# Llama al backend por su puerto localhost-only para que CRON_SECRET nunca
# transite por internet público ni quede en los access logs de nginx.
#
# Instalar en el VPS como /opt/pamir/bin/check-alertas.sh (chmod 700) e
# invocar bajo flock para impedir solapamientos (el handler NO es seguro
# ante concurrencia):
#   */10 * * * * flock -n /opt/pamir/check-alertas.lock \
#     /opt/pamir/bin/check-alertas.sh >> /opt/pamir/cron.log 2>&1
set -euo pipefail

source <(grep -E '^CRON_SECRET=' /opt/pamir/.env)

curl -fsS --max-time 300 \
  "http://127.0.0.1:3001/api/cron/check-alertas?secret=${CRON_SECRET}"
echo
