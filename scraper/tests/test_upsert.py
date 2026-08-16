"""Postgres-specific — the UPSERT logic relies on real NUMERIC/TIMESTAMPTZ
comparison semantics and transactional rollback, which sqlite can't provide.
Gated on TEST_DATABASE_URL (or DATABASE_URL) pointing at a real Postgres
with the etf_flows table already migrated; skipped otherwise."""
import os
from datetime import date

import asyncpg
import pytest

from app.parse import ParsedFlowRow
from app.upsert import _asyncpg_dsn, run_upsert

_DATABASE_URL = os.environ.get("TEST_DATABASE_URL") or os.environ.get("DATABASE_URL", "")

pytestmark = pytest.mark.skipif(
    not _DATABASE_URL.startswith("postgresql"),
    reason="needs a real Postgres reachable via TEST_DATABASE_URL/DATABASE_URL",
)


@pytest.fixture(autouse=True)
async def _clean_table():
    conn = await asyncpg.connect(_asyncpg_dsn(_DATABASE_URL))
    try:
        await conn.execute("TRUNCATE TABLE etf_flows")
    finally:
        await conn.close()
    yield


async def _fetch_row(flow_date: date) -> asyncpg.Record | None:
    conn = await asyncpg.connect(_asyncpg_dsn(_DATABASE_URL))
    try:
        return await conn.fetchrow("SELECT * FROM etf_flows WHERE flow_date = $1", flow_date)
    finally:
        await conn.close()


async def _row_count() -> int:
    conn = await asyncpg.connect(_asyncpg_dsn(_DATABASE_URL))
    try:
        return await conn.fetchval("SELECT COUNT(*) FROM etf_flows")
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_first_run_backfill_inserts_all_rows_with_observed_at_null():
    rows = [
        ParsedFlowRow(flow_date=date(2024, 1, 11), total_net_flow=655.3),
        ParsedFlowRow(flow_date=date(2024, 1, 12), total_net_flow=-43.1),
    ]
    await run_upsert(rows, _DATABASE_URL)

    assert await _row_count() == 2
    row = await _fetch_row(date(2024, 1, 11))
    assert row["observed_at"] is None
    assert float(row["total_net_flow"]) == 655.3


@pytest.mark.asyncio
async def test_normal_run_new_row_gets_real_observed_at():
    # Seed a non-empty table so the second run is treated as "normal", not backfill.
    await run_upsert([ParsedFlowRow(flow_date=date(2024, 1, 1), total_net_flow=1.0)], _DATABASE_URL)

    await run_upsert([ParsedFlowRow(flow_date=date(2024, 1, 2), total_net_flow=2.0)], _DATABASE_URL)

    row = await _fetch_row(date(2024, 1, 2))
    assert row["observed_at"] is not None


@pytest.mark.asyncio
async def test_revision_preserves_observed_at_and_updates_value():
    await run_upsert([ParsedFlowRow(flow_date=date(2024, 1, 1), total_net_flow=1.0)], _DATABASE_URL)
    await run_upsert([ParsedFlowRow(flow_date=date(2024, 1, 2), total_net_flow=100.0)], _DATABASE_URL)
    before = await _fetch_row(date(2024, 1, 2))

    await run_upsert([ParsedFlowRow(flow_date=date(2024, 1, 2), total_net_flow=999.0)], _DATABASE_URL)
    after = await _fetch_row(date(2024, 1, 2))

    assert float(after["total_net_flow"]) == 999.0
    assert after["observed_at"] == before["observed_at"]
    assert after["updated_at"] > before["updated_at"]


@pytest.mark.asyncio
async def test_unchanged_value_is_a_true_no_op():
    await run_upsert([ParsedFlowRow(flow_date=date(2024, 1, 1), total_net_flow=1.0)], _DATABASE_URL)
    await run_upsert([ParsedFlowRow(flow_date=date(2024, 1, 2), total_net_flow=50.0)], _DATABASE_URL)
    before = await _fetch_row(date(2024, 1, 2))

    await run_upsert([ParsedFlowRow(flow_date=date(2024, 1, 2), total_net_flow=50.0)], _DATABASE_URL)
    after = await _fetch_row(date(2024, 1, 2))

    assert after["updated_at"] == before["updated_at"]


@pytest.mark.asyncio
async def test_mid_backfill_crash_rolls_back_to_empty_table():
    class _ExplodingRow:
        flow_date = date(2024, 1, 3)
        total_net_flow = "not-a-number"  # forces a DB type error on the 3rd insert

    rows = [
        ParsedFlowRow(flow_date=date(2024, 1, 1), total_net_flow=1.0),
        ParsedFlowRow(flow_date=date(2024, 1, 2), total_net_flow=2.0),
        _ExplodingRow(),
    ]

    with pytest.raises(Exception):
        await run_upsert(rows, _DATABASE_URL)

    assert await _row_count() == 0
