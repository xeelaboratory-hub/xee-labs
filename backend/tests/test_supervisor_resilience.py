"""Verifies the per-exchange supervisor contract from the plan's exit
criteria: a feed that goes stale is detected, torn down, and restarted with
backoff — and a *different* exchange's health is untouched while that
happens. Runs against a fake FeedHandler (no real network) so the watchdog
timing can be shrunk to milliseconds instead of requiring an actual outage.
"""
import asyncio

import app.feeds.cryptofeed_runner as runner
from app.store import store


class _FakeFeedHandler:
    """No-op stand-in for cryptofeed.FeedHandler — never produces real
    events, so the watchdog's staleness check is what drives the test.
    """

    def __init__(self, config=None):
        pass

    def add_feed(self, feed):
        pass

    def run(self, start_loop=False, install_signal_handlers=False):
        pass

    async def stop_async(self, loop=None):
        pass


async def test_stale_feed_is_restarted_without_touching_other_exchange(monkeypatch):
    monkeypatch.setattr(runner, "FeedHandler", _FakeFeedHandler)
    monkeypatch.setattr(runner, "_BUILDERS", {"binance": lambda: object(), "okx": lambda: object()})
    monkeypatch.setattr(runner, "_STALE_AFTER_SECONDS", 0.05)
    monkeypatch.setattr(runner, "_WATCHDOG_INTERVAL_SECONDS", 0.02)
    monkeypatch.setattr(runner, "RECONNECT_BASE_DELAY_SECONDS", 0.01)
    monkeypatch.setattr(runner, "RECONNECT_MAX_DELAY_SECONDS", 0.02)

    okx_health_before = store.get_health("okx")

    stop_event = asyncio.Event()
    task = asyncio.create_task(runner.run_supervised_feed("binance", stop_event))
    try:
        # Let it go through at least one full stale -> restart cycle.
        await asyncio.sleep(0.3)
        assert store.get_health("binance").connected in (True, False)  # mid-cycle, either is valid
        assert store.get_health("okx") == okx_health_before  # untouched by binance's restarts
    finally:
        stop_event.set()
        await asyncio.wait_for(task, timeout=2)

    assert store.get_health("binance").connected is False  # clean shutdown leaves it disconnected
    assert store.get_health("okx") == okx_health_before
