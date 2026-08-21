"""The watchdog has two independent triggers, and the second one exists
because of a specific, reproduced outage.

OKX splits a feed across sockets: ticker and book ride /public, candles ride
/business. When /public dropped, cryptofeed retired it permanently (retries=0
at the time) while /business kept delivering — so traffic never stopped, the
event-based trigger stayed quiet, and prices sat frozen for 37 minutes.

Trigger one still watches for total silence. Trigger two watches the price
clock specifically, at a much looser threshold, because a feed can be busy and
priceless at the same time.
"""
import asyncio
import time

import pytest

import app.feeds.cryptofeed_runner as runner
from app.store import store


@pytest.fixture(autouse=True)
def _reset_store():
    yield
    store._health.clear()


def _fresh(seconds_ago: float) -> int:
    return int((time.time() - seconds_ago) * 1000)


async def _watch(exchange: str, timeout: float) -> bool:
    """Run the watchdog until it declares the feed dead, or give up."""
    stop_event = asyncio.Event()
    task = asyncio.create_task(runner._wait_until_stale_or_stopped(exchange, stop_event))
    try:
        return await asyncio.wait_for(asyncio.shield(task), timeout=timeout)
    except asyncio.TimeoutError:
        stop_event.set()
        await asyncio.wait_for(task, timeout=1)
        return False


@pytest.mark.asyncio
async def test_total_silence_trips_the_watchdog(monkeypatch):
    monkeypatch.setattr(runner, "_WATCHDOG_INTERVAL_SECONDS", 0.01)
    monkeypatch.setattr(runner, "_STALE_AFTER_SECONDS", 0.05)
    store.set_health("binance", connected=True, last_event_at=_fresh(10), last_tick_at=_fresh(10))

    assert await _watch("binance", timeout=1) is True


@pytest.mark.asyncio
async def test_a_busy_feed_with_dead_prices_trips_the_watchdog(monkeypatch):
    """The reproduced outage: candles keep arriving, prices do not."""
    monkeypatch.setattr(runner, "_WATCHDOG_INTERVAL_SECONDS", 0.01)
    monkeypatch.setattr(runner, "_STALE_AFTER_SECONDS", 3600)  # traffic looks perfectly healthy
    monkeypatch.setattr(runner, "_STALE_TICK_AFTER_SECONDS", 0.05)
    store.set_health("okx", connected=True, last_event_at=_fresh(0), last_tick_at=_fresh(600))

    assert await _watch("okx", timeout=1) is True


@pytest.mark.asyncio
async def test_a_healthy_feed_is_left_alone(monkeypatch):
    """Guards the v1.6.5 regression: normal cadence must not trip anything.

    A tick clock a few seconds old is ordinary — the measured worst case on a
    healthy OKX ticker was 3.3s — and tearing the feed down over it produced a
    restart loop every 115s.
    """
    monkeypatch.setattr(runner, "_WATCHDOG_INTERVAL_SECONDS", 0.01)
    store.set_health("okx", connected=True, last_event_at=_fresh(0.2), last_tick_at=_fresh(5))

    assert await _watch("okx", timeout=0.3) is False


@pytest.mark.asyncio
async def test_a_feed_with_no_tick_yet_is_judged_on_traffic_alone(monkeypatch):
    """lastTickAt is None until a feed's first price; that must not read as dead."""
    monkeypatch.setattr(runner, "_WATCHDOG_INTERVAL_SECONDS", 0.01)
    monkeypatch.setattr(runner, "_STALE_TICK_AFTER_SECONDS", 0.05)
    store.set_health("okx", connected=True, last_event_at=_fresh(0), last_tick_at=None)

    assert await _watch("okx", timeout=0.3) is False


@pytest.mark.asyncio
async def test_stop_event_wins_over_both_triggers(monkeypatch):
    monkeypatch.setattr(runner, "_WATCHDOG_INTERVAL_SECONDS", 0.01)
    monkeypatch.setattr(runner, "_STALE_AFTER_SECONDS", 0.01)
    store.set_health("okx", connected=True, last_event_at=_fresh(600), last_tick_at=_fresh(600))

    stop_event = asyncio.Event()
    stop_event.set()

    assert await runner._wait_until_stale_or_stopped("okx", stop_event) is False
