"""Idempotent UPSERT of parsed Farside rows into `etf_flows`.

Raw asyncpg SQL only — this module deliberately never imports backend/'s
SQLAlchemy models/Base, so it structurally cannot run schema DDL. The table
only ever changes via backend/'s own Alembic migrations.
"""
import logging

import asyncpg

from app.parse import ParsedFlowRow

LOG = logging.getLogger("etf_scraper.upsert")


def _asyncpg_dsn(database_url: str) -> str:
    """DATABASE_URL arrives as a SQLAlchemy `postgresql+asyncpg://...` DSN —
    raw `asyncpg.connect()` only understands the plain `postgresql://...`
    form. Same one-line normalization as backend/app/db/etf_flow_listener.py."""
    return database_url.replace("postgresql+asyncpg://", "postgresql://", 1)


async def run_upsert(rows: list[ParsedFlowRow], database_url: str) -> None:
    conn = await asyncpg.connect(_asyncpg_dsn(database_url))
    try:
        count = await conn.fetchval("SELECT COUNT(*) FROM etf_flows")
        if count == 0:
            await _backfill(conn, rows)
        else:
            await _incremental(conn, rows)
    finally:
        await conn.close()


async def _backfill(conn: asyncpg.Connection, rows: list[ParsedFlowRow]) -> None:
    """First run: the table is empty, so every row is historical — insert all
    of them with observed_at = NULL in one transaction. If the process
    crashes partway, the transaction rolls back to an empty table, so the
    next scheduled run correctly re-detects "first run" and retries the full
    backfill instead of half-treating the rest as newly observed."""
    LOG.info("first run detected (etf_flows is empty) — backfilling %d historical rows", len(rows))
    async with conn.transaction():
        for row in rows:
            await conn.execute(
                """
                INSERT INTO etf_flows (flow_date, total_net_flow, observed_at, updated_at)
                VALUES ($1, $2, NULL, now())
                """,
                row.flow_date,
                row.total_net_flow,
            )


async def _incremental(conn: asyncpg.Connection, rows: list[ParsedFlowRow]) -> None:
    """Normal run: a row not yet in the DB is genuinely new (observed_at =
    now()); an existing row whose value actually changed is a revision
    (observed_at preserved, only total_net_flow/updated_at change); an
    unchanged row is a true no-op (the WHERE guard means no UPDATE is even
    issued, so the DB trigger never fires and no NOTIFY is sent)."""
    for row in rows:
        await conn.execute(
            """
            INSERT INTO etf_flows (flow_date, total_net_flow, observed_at, updated_at)
            VALUES ($1, $2, now(), now())
            ON CONFLICT (flow_date) DO UPDATE
            SET total_net_flow = EXCLUDED.total_net_flow, updated_at = now()
            WHERE etf_flows.total_net_flow IS DISTINCT FROM EXCLUDED.total_net_flow
            """,
            row.flow_date,
            row.total_net_flow,
        )
