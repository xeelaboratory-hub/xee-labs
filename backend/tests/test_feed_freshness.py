"""The feed's freshness clock must track prices, not merely traffic.

Regression cover for a live incident: OKX's ticker channel died while its
candle and book channels kept flowing. Every callback advanced the health
timestamp, so `lastEventAt` stayed fresh, the runner's 60s watchdog never
restarted the feed, and the frontend's stale-data banner never fired — while
the stored tick sat 37 minutes old and mispriced a live position.
"""
import asyncio
import types

import pytest

from app.feeds._common import make_book_callback, make_candle_callback, make_ticker_callback
from app.store import store


@pytest.fixture(autouse=True)
def _reset_store():
    yield
    store._health.clear()
    store._ticks.clear()


def _ticker(symbol: str, *, bid: float, ask: float, ts: float):
    return types.SimpleNamespace(symbol=symbol, bid=bid, ask=ask, timestamp=ts)


def _candle(symbol: str, *, ts: float):
    return types.SimpleNamespace(
        symbol=symbol, start=int(ts), open=1.0, high=1.0, low=1.0, close=1.0,
        volume=1.0, timestamp=ts, interval="1m", closed=False,
    )


BINANCE_SYMBOL = "BTC-USDT-PERP"
OLD_TS = 1_787_290_000.0
NEW_TS = OLD_TS + 3600  # an hour later


def test_ticker_event_advances_the_freshness_clock():
    asyncio.run(make_ticker_callback("binance")(_ticker(BINANCE_SYMBOL, bid=100.0, ask=100.1, ts=OLD_TS), OLD_TS))

    health = store.get_health("binance")
    assert health.connected is True
    assert health.lastEventAt == int(OLD_TS * 1000)


def test_candles_keep_the_connection_up_without_vouching_for_price_freshness():
    asyncio.run(make_ticker_callback("binance")(_ticker(BINANCE_SYMBOL, bid=100.0, ask=100.1, ts=OLD_TS), OLD_TS))
    asyncio.run(make_candle_callback("binance")(_candle(BINANCE_SYMBOL, ts=NEW_TS), NEW_TS))

    health = store.get_health("binance")
    assert health.connected is True
    # The clock must still point at the last *tick*, an hour ago — this is the
    # assertion the incident violated.
    assert health.lastEventAt == int(OLD_TS * 1000)


def test_book_events_do_not_advance_the_freshness_clock():
    asyncio.run(make_ticker_callback("binance")(_ticker(BINANCE_SYMBOL, bid=100.0, ask=100.1, ts=OLD_TS), OLD_TS))

    book = types.SimpleNamespace(symbol=BINANCE_SYMBOL, timestamp=NEW_TS, delta=None, book={})
    asyncio.run(make_book_callback("binance")(book, NEW_TS))

    assert store.get_health("binance").lastEventAt == int(OLD_TS * 1000)


def test_a_later_tick_does_advance_the_clock():
    asyncio.run(make_ticker_callback("binance")(_ticker(BINANCE_SYMBOL, bid=100.0, ask=100.1, ts=OLD_TS), OLD_TS))
    asyncio.run(make_ticker_callback("binance")(_ticker(BINANCE_SYMBOL, bid=200.0, ask=200.1, ts=NEW_TS), NEW_TS))

    assert store.get_health("binance").lastEventAt == int(NEW_TS * 1000)
    tick = store.get_tick("BINANCE:BTCUSD")
    assert tick is not None and tick.bid == 200.0
