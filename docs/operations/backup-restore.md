# Postgres backup & restore

Minimal `pg_dump`/`pg_restore` workflow for the `postgres` docker-compose
service. No HA, no replica, no managed backup infrastructure — just a real,
verified way to get the data back if the volume is lost or a bad migration
needs undoing.

## Where the data lives

The `postgres` service stores everything in the named Docker volume
`opencharts_postgres-data` (see `docker-compose.yml`'s `volumes:` block —
compose prefixes it with the project name). Losing that volume loses the
database; it is not backed up by anything outside this workflow.

## Taking a backup

```bash
docker compose up -d postgres     # if not already running
scripts/backup-postgres.sh        # writes to ./backups/ by default
```

Each run produces `backups/xee_labs-<UTC timestamp>.dump` — a `pg_dump -Fc`
(custom format) archive. The script runs `pg_dump` *inside* the postgres
container over its local socket, so no database password needs to be typed,
stored in the script, or exported to the shell. `backups/` is gitignored —
these files are never committed. A failed backup exits non-zero (`set -e`
propagates `pg_dump`'s own exit code).

There's no automated schedule yet — run this manually before anything risky
(a migration, a version upgrade) and periodically otherwise (e.g. a cron
entry calling this script is a reasonable next step, not included here).

## Restoring

```bash
scripts/restore-postgres.sh backups/xee_labs-<timestamp>.dump
```

With no third argument this restores into a **throwaway**
`xee_labs_restore_check` database (dropped and recreated), so you can verify
a backup is actually usable without touching real data:

```bash
docker compose exec postgres psql -U xee_labs -d xee_labs_restore_check -c '\dt'
```

Drop it when done: `docker compose exec postgres psql -U xee_labs -d postgres -c 'DROP DATABASE xee_labs_restore_check;'`.

### Restoring onto the live database

```bash
scripts/restore-postgres.sh backups/xee_labs-<timestamp>.dump xee_labs
```

This **overwrites the live database's current contents**. The script never
does this silently or non-interactively — it prints a warning and requires
typing `yes` at a prompt before proceeding.

## Rollback limitation this covers

Rolling back to an older release tag against a live volume does not work by
itself — `docker-entrypoint.sh` runs `alembic upgrade head` unconditionally
on container start, and the older code doesn't know about migrations applied
after it. Rolling back for real means: restore a pre-upgrade backup with the
command above (onto the live database), *then* check out the older tag —
not the other way around.

## `CREDENTIAL_ENCRYPTION_KEY` warning

This key encrypts every stored exchange API credential
(`backend/app/security/encryption.py`). There is no key-rotation or
re-encryption tooling. If it changes — intentionally or by an `.env` mistake
— every stored credential becomes permanently undecryptable; the only
recovery is each user deleting and re-adding their API keys. Treat the value
that's live in production with the same care as any other production
secret, and never regenerate or edit it as a "just in case" hardening step.
