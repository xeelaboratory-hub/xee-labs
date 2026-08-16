"""Postgres LISTEN/NOTIFY bridge: the `etf_flows` table's triggers (see the
`create_etf_flows` Alembic migration) NOTIFY on channel `etf_flow_changed`
whenever a genuinely new/live row is inserted or an existing row's
`total_net_flow` actually changes. This module turns those notifications
into `EtfFlowUpdatedEvent`s on the existing in-process `EventBus`, so they
reach `/ws` exactly like any other market-data event.

Uses a raw asyncpg connection (not SQLAlchemy) — SQLAlchemy's async session
layer doesn't expose `add_listener()` for a long-lived LISTEN session.
"""
import asyncio
import json
import logging
import random

import asyncpg

from app.bus import bus
from app.config import RECONNECT_BASE_DELAY_SECONDS, RECONNECT_MAX_DELAY_SECONDS
from app.db.session import DATABASE_URL
from app.schemas import EtfFlowUpdatedEvent

LOG = logging.getLogger("etf_flow_listener")
_CHANNEL = "etf_flow_changed"


def _asyncpg_dsn(database_url: str) -> str:
    """DATABASE_URL is a SQLAlchemy `postgresql+asyncpg://...` DSN — raw
    `asyncpg.connect()` only understands the plain `postgresql://...` form."""
    return database_url.replace("postgresql+asyncpg://", "postgresql://", 1)


def _on_notify(_connection: object, _pid: int, _channel: str, payload: str) -> None:
    try:
        data = json.loads(payload)
        event = EtfFlowUpdatedEvent(**data)
    except Exception:
        LOG.exception("failed to parse etf_flow_changed payload: %r", payload)
        return
    bus.publish(event)


async def run_etf_flow_listener(stop_event: asyncio.Event) -> None:
    """Supervised LISTEN loop — mirrors feeds/cryptofeed_runner.py's
    capped/jittered-backoff reconnect style."""
    delay = RECONNECT_BASE_DELAY_SECONDS
    dsn = _asyncpg_dsn(DATABASE_URL)

    while not stop_event.is_set():
        conn: asyncpg.Connection | None = None
        try:
            conn = await asyncpg.connect(dsn)
            await conn.add_listener(_CHANNEL, _on_notify)
            LOG.info("etf_flow_listener: connected, listening on %s", _CHANNEL)
            delay = RECONNECT_BASE_DELAY_SECONDS

            while not stop_event.is_set():
                try:
                    await asyncio.wait_for(stop_event.wait(), timeout=5)
                except asyncio.TimeoutError:
                    pass
                if conn.is_closed():
                    raise ConnectionError("etf_flow_listener: connection closed")
        except Exception:
            if not stop_event.is_set():
                LOG.exception("etf_flow_listener: connection lost, reconnecting")
        finally:
            if conn is not None and not conn.is_closed():
                await conn.close()

        if stop_event.is_set():
            return

        jittered = delay * (0.8 + random.random() * 0.4)
        await asyncio.sleep(jittered)
        delay = min(delay * 2, RECONNECT_MAX_DELAY_SECONDS)
