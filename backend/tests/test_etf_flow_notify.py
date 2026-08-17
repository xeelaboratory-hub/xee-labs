"""Postgres-specific — the etf_flows triggers/NOTIFY behavior cannot run
against sqlite (backend/tests/conftest.py defaults DATABASE_URL to
sqlite+aiosqlite:///:memory:). Gated on TEST_DATABASE_URL/DATABASE_URL
pointing at a real Postgres with the etf_flows migration already applied;
skipped otherwise. Run manually/in CI against real Postgres, e.g.:
  docker compose up postgres -d
  TEST_DATABASE_URL=postgresql://xee_labs:xee_labs@localhost:5432/xee_labs \\
    pytest backend/tests/test_etf_flow_notify.py
"""
import asyncio
import json
import os
from datetime import date, datetime, timezone

import asyncpg
import pytest

_RAW_DATABASE_URL = os.environ.get("TEST_DATABASE_URL") or os.environ.get("DATABASE_URL", "")

pytestmark = pytest.mark.skipif(
    not _RAW_DATABASE_URL.startswith("postgresql"),
    reason="needs a real Postgres reachable via TEST_DATABASE_URL/DATABASE_URL",
)


def _dsn() -> str:
    return _RAW_DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://", 1)


@pytest.fixture(autouse=True)
async def _clean_table():
    conn = await asyncpg.connect(_dsn())
    try:
        await conn.execute("TRUNCATE TABLE etf_flows")
    finally:
        await conn.close()
    yield


async def _collect_one_notification(action) -> dict | None:
    """Runs `action` while LISTENing on etf_flow_changed; returns the first
    payload received within a short timeout, or None if none arrived."""
    received: list[dict] = []
    conn = await asyncpg.connect(_dsn())

    def _on_notify(_connection, _pid, _channel, payload):
        received.append(json.loads(payload))

    try:
        await conn.add_listener("etf_flow_changed", _on_notify)
        await action()
        # NOTIFY delivery to a LISTENing connection happens on the next
        # event-loop iteration after COMMIT; a short poll is sufficient here.
        for _ in range(20):
            if received:
                break
            await asyncio.sleep(0.05)
    finally:
        await conn.remove_listener("etf_flow_changed", _on_notify)
        await conn.close()

    return received[0] if received else None


async def test_insert_with_observed_at_triggers_new_notify():
    async def action():
        conn = await asyncpg.connect(_dsn())
        try:
            await conn.execute(
                "INSERT INTO etf_flows (flow_date, total_net_flow, observed_at, updated_at) "
                "VALUES ($1, $2, $3, now())",
                date(2024, 1, 12), 1.0, datetime.now(timezone.utc),
            )
        finally:
            await conn.close()

    payload = await _collect_one_notification(action)
    assert payload is not None
    assert payload["changeType"] == "new"
    assert payload["flowDate"] == "2024-01-12"


async def test_insert_with_null_observed_at_never_notifies():
    async def action():
        conn = await asyncpg.connect(_dsn())
        try:
            await conn.execute(
                "INSERT INTO etf_flows (flow_date, total_net_flow, observed_at, updated_at) "
                "VALUES ($1, $2, NULL, now())",
                date(2024, 1, 11), 655.3,
            )
        finally:
            await conn.close()

    payload = await _collect_one_notification(action)
    assert payload is None


async def test_real_revision_triggers_revision_notify():
    seed = await asyncpg.connect(_dsn())
    try:
        await seed.execute(
            "INSERT INTO etf_flows (flow_date, total_net_flow, observed_at, updated_at) "
            "VALUES ($1, $2, NULL, now())",
            date(2024, 1, 13), 1.0,
        )
    finally:
        await seed.close()

    async def action():
        conn = await asyncpg.connect(_dsn())
        try:
            await conn.execute(
                "UPDATE etf_flows SET total_net_flow = $2, updated_at = now() WHERE flow_date = $1",
                date(2024, 1, 13), 999.0,
            )
        finally:
            await conn.close()

    payload = await _collect_one_notification(action)
    assert payload is not None
    assert payload["changeType"] == "revision"
    assert payload["totalNetFlow"] == 999.0


async def test_unchanged_update_never_notifies():
    seed = await asyncpg.connect(_dsn())
    try:
        await seed.execute(
            "INSERT INTO etf_flows (flow_date, total_net_flow, observed_at, updated_at) "
            "VALUES ($1, $2, NULL, now())",
            date(2024, 1, 14), 5.0,
        )
    finally:
        await seed.close()

    async def action():
        conn = await asyncpg.connect(_dsn())
        try:
            await conn.execute(
                "UPDATE etf_flows SET total_net_flow = $2, updated_at = now() WHERE flow_date = $1",
                date(2024, 1, 14), 5.0,
            )
        finally:
            await conn.close()

    payload = await _collect_one_notification(action)
    assert payload is None
