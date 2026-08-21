"""Two clocks, two questions, two consumers.

`lastEventAt` answers "is the connection alive" and is advanced by any feed
traffic. The runner's watchdog reads it, and acting on it destroys and
rebuilds a feed — so it must stay broad.

`lastTickAt` answers "are prices still arriving" and is advanced by ticker
events only. The stale-data banner reads it, and acting on it just shows a
warning — so it can be strict.

Both directions of collapsing them into one signal have already caused an
incident, and both are pinned below:

1. Judging price freshness on `lastEventAt`: OKX's ticker channel died while
   its candle and book channels kept flowing, so nothing warned for 37
   minutes and a live position was mispriced by $49.
2. Judging connection liveness on ticks (v1.6.5): the ticker's normal cadence
   sat close enough to the watchdog's 60s threshold that a healthy OKX feed
   was torn down and rebuilt every 115s.
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


SYMBOL = "BTC-USDT-PERP"
SYMBOL_ID = "BINANCE:BTCUSD"
OLD_TS = 1_787_290_000.0
NEW_TS = OLD_TS + 3600  # an hour later


def _send_ticker(ts: float, *, bid: float = 100.0) -> None:
    asyncio.run(make_ticker_callback("binance")(_ticker(SYMBOL, bid=bid, ask=bid + 0.1, ts=ts), ts))


def _send_candle(ts: float) -> None:
    asyncio.run(make_candle_callback("binance")(_candle(SYMBOL, ts=ts), ts))


def _send_book(ts: float) -> None:
    book = types.SimpleNamespace(symbol=SYMBOL, timestamp=ts, delta=None, book={})
    asyncio.run(make_book_callback("binance")(book, ts))


def test_a_ticker_event_advances_both_clocks():
    """A price is traffic *and* a quote, so it is the only writer of both."""
    _send_ticker(OLD_TS)

    health = store.get_health("binance")
    assert health.connected is True
    assert health.lastEventAt == int(OLD_TS * 1000)
    assert health.lastTickAt == int(OLD_TS * 1000)

    tick = store.get_tick(SYMBOL_ID)
    assert tick is not None and tick.bid == 100.0


def test_candles_advance_liveness_but_not_price_freshness():
    _send_ticker(OLD_TS)
    _send_candle(NEW_TS)

    health = store.get_health("binance")
    assert health.lastEventAt == int(NEW_TS * 1000)  # connection is alive
    assert health.lastTickAt == int(OLD_TS * 1000)  # prices are an hour old


def test_book_events_advance_liveness_but_not_price_freshness():
    _send_ticker(OLD_TS)
    _send_book(NEW_TS)

    health = store.get_health("binance")
    assert health.lastEventAt == int(NEW_TS * 1000)
    assert health.lastTickAt == int(OLD_TS * 1000)


def test_the_dead_ticker_channel_is_now_visible():
    """The exact shape of the $49 incident, and the assertion that catches it.

    Non-ticker traffic keeps arriving, so any watchdog keyed on liveness is
    correctly quiet — while lastTickAt reports prices as an hour stale.
    """
    _send_ticker(OLD_TS)
    for offset in (600, 1200, 1800, 2400, 3000, 3600):
        _send_candle(OLD_TS + offset)
        _send_book(OLD_TS + offset)

    health = store.get_health("binance")
    assert health.connected is True
    assert health.lastEventAt == int(NEW_TS * 1000)
    assert health.lastTickAt == int(OLD_TS * 1000)
    assert health.lastEventAt - health.lastTickAt == 3600 * 1000

    # The stored price is exactly as old as lastTickAt says it is.
    tick = store.get_tick(SYMBOL_ID)
    assert tick is not None and tick.occurredAt == health.lastTickAt


def test_a_later_tick_advances_both_clocks_again():
    _send_ticker(OLD_TS)
    _send_candle(OLD_TS + 60)
    _send_ticker(NEW_TS, bid=200.0)

    health = store.get_health("binance")
    assert health.lastEventAt == int(NEW_TS * 1000)
    assert health.lastTickAt == int(NEW_TS * 1000)
    tick = store.get_tick(SYMBOL_ID)
    assert tick is not None and tick.bid == 200.0


def test_an_unknown_exchange_reports_both_clocks_empty():
    health = store.get_health("kraken")

    assert health.connected is False
    assert health.lastEventAt is None
    assert health.lastTickAt is None
