"""Runs both exchanges' CryptoFeed connections inside FastAPI/uvicorn's own
event loop (validated safe via spike: FeedHandler.run(start_loop=False)
schedules tasks on the currently-running loop and returns immediately).

Each exchange is supervised independently by its own coroutine with its own
FeedHandler instance and its own capped, jittered exponential backoff — one
exchange's feed dying must never affect the other's, and cryptofeed's own
per-connection retries are disabled (retries=0 in binance.py/okx.py) so this
loop is the single source of truth for reconnect timing.
"""
import asyncio
import logging
import random
import time

from cryptofeed import FeedHandler

from app.config import RECONNECT_BASE_DELAY_SECONDS, RECONNECT_MAX_DELAY_SECONDS
from app.feeds import binance as binance_feed
from app.feeds import okx as okx_feed
from app.store import store

LOG = logging.getLogger("cryptofeed_runner")

_STALE_AFTER_SECONDS = 60  # no live event within this window => treat the feed as dead
_WATCHDOG_INTERVAL_SECONDS = 5

_BUILDERS = {
    "binance": binance_feed.build_feed,
    "okx": okx_feed.build_feed,
}


async def run_supervised_feed(exchange: str, stop_event: asyncio.Event) -> None:
    build_feed = _BUILDERS[exchange]
    delay = RECONNECT_BASE_DELAY_SECONDS

    while not stop_event.is_set():
        handler = FeedHandler(config={"log": {"disabled": True}})
        handler.add_feed(build_feed())
        handler.run(start_loop=False, install_signal_handlers=False)
        store.set_health(exchange, connected=True, last_event_at=int(time.time() * 1000))
        LOG.info("%s: feed (re)started", exchange)

        died = await _wait_until_stale_or_stopped(exchange, stop_event)
        await _shutdown(handler)
        store.set_health(exchange, connected=False, last_event_at=None)

        if stop_event.is_set():
            return

        jittered = delay * (0.8 + random.random() * 0.4)
        LOG.warning("%s: feed stale/dead, restarting in %.1fs", exchange, jittered)
        await asyncio.sleep(jittered)
        delay = min(delay * 2, RECONNECT_MAX_DELAY_SECONDS) if died else RECONNECT_BASE_DELAY_SECONDS


async def _wait_until_stale_or_stopped(exchange: str, stop_event: asyncio.Event) -> bool:
    while not stop_event.is_set():
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=_WATCHDOG_INTERVAL_SECONDS)
            return False  # stop_event was set
        except asyncio.TimeoutError:
            pass

        health = store.get_health(exchange)
        if health.lastEventAt is None:
            continue
        age_seconds = time.time() - health.lastEventAt / 1000
        if age_seconds > _STALE_AFTER_SECONDS:
            return True
    return False


async def _shutdown(handler: FeedHandler) -> None:
    # Deliberately NOT handler.stop()/close(): both call loop.run_until_complete()
    # or cancel every task on the loop, which is only safe when CryptoFeed owns
    # the whole process loop. We share FastAPI/uvicorn's loop, so we use the
    # async-safe stop_async() (per-feed connection teardown only) instead.
    try:
        await handler.stop_async(loop=asyncio.get_running_loop())
    except Exception:
        LOG.exception("error while shutting down feed handler")
