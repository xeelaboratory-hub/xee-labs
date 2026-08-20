#!/usr/bin/env bash
set -euo pipefail

# Restore a pg_dump custom-format (-Fc) archive, created by
# backup-postgres.sh, into a Postgres database inside the docker-compose
# "postgres" service.
#
# Defaults to a fresh, disposable database so a restore can be verified
# without touching real data. Restoring on top of the live database is a
# separate, explicitly-confirmed path — this script never does it silently
# or non-interactively.
#
# Usage:
#   scripts/restore-postgres.sh <dump-file> [target-db]
#
# Examples:
#   scripts/restore-postgres.sh backups/xee_labs-20260101T000000Z.dump
#       -> restores into a throwaway "xee_labs_restore_check" database
#          (dropped and recreated) for verification.
#   scripts/restore-postgres.sh backups/xee_labs-20260101T000000Z.dump xee_labs
#       -> restores into the LIVE database, overwriting its current
#          contents. Requires typing "yes" at a prompt to proceed.

COMPOSE_SERVICE="postgres"
ADMIN_DB="postgres"
DB_USER="${POSTGRES_USER:-xee_labs}"
LIVE_DB="${POSTGRES_DB:-xee_labs}"

DUMP_FILE="${1:?usage: restore-postgres.sh <dump-file> [target-db]}"
TARGET_DB="${2:-xee_labs_restore_check}"

if [ ! -f "$DUMP_FILE" ]; then
  echo "restore-postgres: dump file not found: $DUMP_FILE" >&2
  exit 1
fi

if ! docker compose ps --status running --services 2>/dev/null | grep -qx "$COMPOSE_SERVICE"; then
  echo "restore-postgres: '$COMPOSE_SERVICE' service is not running — start it first with:" >&2
  echo "  docker compose up -d postgres" >&2
  exit 1
fi

if [ "$TARGET_DB" = "$LIVE_DB" ]; then
  echo "!! This restores on top of the LIVE database ('$LIVE_DB') and destroys its current contents." >&2
  read -r -p "Type 'yes' to continue: " CONFIRM
  if [ "$CONFIRM" != "yes" ]; then
    echo "restore-postgres: aborted." >&2
    exit 1
  fi
fi

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
CONTAINER_TMP="/tmp/restore-${TIMESTAMP}.dump"

docker compose exec -T "$COMPOSE_SERVICE" \
  psql -U "$DB_USER" -d "$ADMIN_DB" -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS \"$TARGET_DB\";" \
  -c "CREATE DATABASE \"$TARGET_DB\" OWNER \"$DB_USER\";"

docker compose cp "$DUMP_FILE" "$COMPOSE_SERVICE:$CONTAINER_TMP"
docker compose exec -T "$COMPOSE_SERVICE" \
  pg_restore -U "$DB_USER" -d "$TARGET_DB" --no-owner "$CONTAINER_TMP"
docker compose exec -T "$COMPOSE_SERVICE" rm -f "$CONTAINER_TMP"

echo "restore-postgres: restored '$DUMP_FILE' into database '$TARGET_DB'"
