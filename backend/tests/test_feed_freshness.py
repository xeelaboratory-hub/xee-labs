"""The health timestamp means "the connection is alive" — nothing more.

Two incidents shaped this, in opposite directions, and both are pinned here.

1. OKX's ticker channel died while its candle and book channels kept flowing.
   Ticks froze for 37 minutes while `lastEventAt` stayed fresh, and a live
   position was mispriced by $49 with no warning. The lesson: this timestamp
   does *not* prove prices are flowing.

2. v1.6.5 tried to fix that by narrowing the clock to ticker events only.
   OKX's ticker arrives roughly once every 55-60s here — just under the
   runner's 60s watchdog — so a perfectly healthy feed was torn down and
   rebuilt every 115s. The lesson: this timestamp must stay broad, because
   the watchdog depends on it meaning liveness.

Price freshness is therefore *not* this signal's job. It is enforced
client-side in `src/lib/livePnl.ts`, which reads each tick's own exchange
timestamp and ignores this health field entirely.
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


def _send_ticker(ts: float, *, bid: float = 100.0) -> None:
    asyncio.run(make_ticker_callback("binance")(_ticker(BINANCE_SYMBOL, bid=bid, ask=bid + 0.1, ts=ts), ts))


def test_ticker_events_advance_the_clock_and_store_the_tick():
    _send_ticker(OLD_TS)

    health = store.get_health("binance")
    assert health.connected is True
    assert health.lastEventAt == int(OLD_TS * 1000)

    tick = store.get_tick("BINANCE:BTCUSD")
    assert tick is not None and tick.bid == 100.0


def test_candles_advance_the_clock_because_they_prove_the_connection_is_alive():
    # Narrowing this to ticker-only is what put OKX into a 115s restart loop
    # (see module docstring). Candles are traffic, and traffic is liveness.
    _send_ticker(OLD_TS)
    asyncio.run(make_candle_callback("binance")(_candle(BINANCE_SYMBOL, ts=NEW_TS), NEW_TS))

    assert store.get_health("binance").lastEventAt == int(NEW_TS * 1000)


def test_book_events_advance_the_clock_for_the_same_reason():
    _send_ticker(OLD_TS)

    book = types.SimpleNamespace(symbol=BINANCE_SYMBOL, timestamp=NEW_TS, delta=None, book={})
    asyncio.run(make_book_callback("binance")(book, NEW_TS))

    assert store.get_health("binance").lastEventAt == int(NEW_TS * 1000)


def test_a_fresh_health_clock_does_not_imply_a_fresh_tick():
    """The gap that cost $49 — pinned so it stays visible rather than surprising.

    Non-ticker traffic keeps the connection's clock current while the stored
    price stays exactly as old as the last real quote. Anything pricing a
    position must read the tick's own timestamp, not this one.
    """
    _send_ticker(OLD_TS)
    asyncio.run(make_candle_callback("binance")(_candle(BINANCE_SYMBOL, ts=NEW_TS), NEW_TS))

    assert store.get_health("binance").lastEventAt == int(NEW_TS * 1000)
    tick = store.get_tick("BINANCE:BTCUSD")
    assert tick is not None
    assert tick.occurredAt == int(OLD_TS * 1000)  # an hour stale, and only the tick knows it
