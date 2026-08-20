#!/usr/bin/env bash
set -euo pipefail

# Minimal pg_dump backup for the docker-compose "postgres" service.
#
# Runs pg_dump *inside* the postgres container, over its local Unix socket
# (the official postgres image trusts local-socket connections — see its
# default pg_hba.conf) — so no database password needs to live in this
# script, an env var, or the caller's shell history.
#
# Usage:
#   scripts/backup-postgres.sh [output-dir]
#
# Requires the "postgres" service to already be running
# (docker compose up -d postgres).

OUTPUT_DIR="${1:-./backups}"
COMPOSE_SERVICE="postgres"
DB_NAME="${POSTGRES_DB:-xee_labs}"
DB_USER="${POSTGRES_USER:-xee_labs}"

if ! docker compose ps --status running --services 2>/dev/null | grep -qx "$COMPOSE_SERVICE"; then
  echo "backup-postgres: '$COMPOSE_SERVICE' service is not running — start it first with:" >&2
  echo "  docker compose up -d postgres" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="$OUTPUT_DIR/xee_labs-${TIMESTAMP}.dump"
CONTAINER_TMP="/tmp/backup-${TIMESTAMP}.dump"

# -Fc: custom format — compressed, and the only format pg_restore can target
# selectively; required by restore-postgres.sh.
docker compose exec -T "$COMPOSE_SERVICE" \
  pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc -f "$CONTAINER_TMP"

docker compose cp "$COMPOSE_SERVICE:$CONTAINER_TMP" "$OUT_FILE"
docker compose exec -T "$COMPOSE_SERVICE" rm -f "$CONTAINER_TMP"

echo "backup-postgres: wrote $OUT_FILE"
