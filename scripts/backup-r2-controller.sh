#!/bin/bash
# R2 backup controller - reads WeMonitor backup_config table,
# runs backup-r2.sh for each enabled service.
# Deployed via CI to ~/wemonitor/
# Cron: 0 3 * * * /bin/bash $HOME/wemonitor/backup-r2-controller.sh >> /tmp/backup-r2.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_SCRIPT="$SCRIPT_DIR/backup-r2.sh"
WM_DB="$HOME/wemonitor/data/wemonitor.db"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [backup-ctrl] $*"; }

if [ ! -f "$BACKUP_SCRIPT" ]; then
  log "ERROR: $BACKUP_SCRIPT not found"; exit 1
fi
if [ ! -f "$WM_DB" ]; then
  log "WARN: WeMonitor DB not found, skipping"; exit 0
fi
if ! command -v sqlite3 >/dev/null 2>&1; then
  log "ERROR: sqlite3 not installed"; exit 1
fi

SERVICES=$(sqlite3 "$WM_DB" \
  "SELECT service_name FROM backup_config WHERE enabled = 1;" 2>/dev/null || true)

if [ -z "$SERVICES" ]; then
  log "No enabled backup services, skipping"; exit 0
fi

COUNT=$(echo "$SERVICES" | wc -l | tr -d ' ')
log "Starting batch backup ($COUNT services)"

for svc in $SERVICES; do
  log "--- $svc ---"
  if bash "$BACKUP_SCRIPT" "$svc" 2>&1; then
    NOW=$(date +%s000)
    sqlite3 "$WM_DB" \
      "UPDATE backup_config SET last_backup_at = $NOW WHERE service_name = '$svc';" 2>/dev/null || true
    log "$svc done"
  else
    log "ERROR: $svc backup failed, continuing"
  fi
done

log "Batch backup complete"
