"""Runs both exchanges' CryptoFeed connections inside FastAPI/uvicorn's own
event loop (validated safe via spike: FeedHandler.run(start_loop=False)
schedules tasks on the currently-running loop and returns immediately).

Each exchange is supervised independently by its own coroutine with its own
FeedHandler instance and its own capped, jittered exponential backoff — one
exchange's feed dying must never affect the other's.

Recovery is layered. cryptofeed retries an individual socket a bounded number
of times (CONNECTION_RETRIES) so a transient drop heals in about a second;
this supervisor owns everything beyond that — backoff policy and full-feed
rebuilds. The split matters because a feed spans several sockets: OKX puts
ticker and book on /public and candles on /business, so /public can die while
the feed still looks alive from the outside.
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

# No traffic of any kind within this window => the whole feed is dead.
_STALE_AFTER_SECONDS = 60
# No *price* within this window => the ticker path is dead even if other
# channels still deliver. Deliberately far looser than the event window: a
# healthy OKX ticker measured a 3.3s worst-case gap over minutes of clean
# operation, so 120s is a ~36x margin. v1.6.5 keyed the only watchdog to ticks
# at 60s and restart-looped a healthy feed; this is an additional trigger with
# a measured threshold, not a replacement for the one above.
_STALE_TICK_AFTER_SECONDS = 120
_WATCHDOG_INTERVAL_SECONDS = 5

_BUILDERS = {
    "binance": binance_feed.build_feed,
    "okx": okx_feed.build_feed,
}


async def run_supervised_feed(exchange: str, stop_event: asyncio.Event) -> None:
    build_feed = _BUILDERS[exchange]
    delay = RECONNECT_BASE_DELAY_SECONDS

    while not stop_event.is_set():
        # cryptofeed logs connection-level events (EOF, reconnect, give-up)
        # through its own logger. Disabling it hid the OKX /public socket
        # dying for 37 minutes; WARNING keeps that visible without the
        # per-message DEBUG firehose.
        handler = FeedHandler(config={"log": {"filename": "stdout", "level": "WARNING"}})
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
        now = time.time()
        if now - health.lastEventAt / 1000 > _STALE_AFTER_SECONDS:
            LOG.warning("%s: no feed traffic for %ds", exchange, _STALE_AFTER_SECONDS)
            return True
        # A feed can keep delivering candles long after its price socket has
        # gone, which is precisely how the outage above stayed invisible.
        if health.lastTickAt is not None and now - health.lastTickAt / 1000 > _STALE_TICK_AFTER_SECONDS:
            LOG.warning(
                "%s: traffic is flowing but no price for %ds — ticker path is dead",
                exchange, _STALE_TICK_AFTER_SECONDS,
            )
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
