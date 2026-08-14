"""Raw Binance/OKX payload fixtures map to identical Candle/Tick shapes, with
the correct `exchange` field always populated — this is the contract
api/market_data.py and api/ws_gateway.py depend on never seeing raw formats.
"""
import asyncio

import pytest

from app.bus import bus
from app.feeds._common import make_candle_callback, make_ticker_callback
from app.historical.service import normalize_binance_row, normalize_okx_row
from app.store import store

BINANCE_KLINE_ROW = [1700000000000, "100.5", "101.0", "99.5", "100.8", "12.34", 1700000059999, "1234.5", 10, "5.0", "500.0", "0"]
OKX_CANDLE_ROW = ["1700000000000", "100.5", "101.0", "99.5", "100.8", "1234.0", "12.34", "1234.5", "1"]


class FakeTicker:
    def __init__(self, symbol, bid, ask, timestamp):
        self.symbol = symbol
        self.bid = bid
        self.ask = ask
        self.timestamp = timestamp


class FakeCandle:
    def __init__(self, symbol, start, stop, interval, open, high, low, close, volume, closed, timestamp):
        self.symbol = symbol
        self.start = start
        self.stop = stop
        self.interval = interval
        self.open = open
        self.high = high
        self.low = low
        self.close = close
        self.volume = volume
        self.closed = closed
        self.timestamp = timestamp


def test_normalize_binance_row_shape():
    candle = normalize_binance_row(BINANCE_KLINE_ROW, symbol_id="BINANCE:BTCUSD")
    assert candle.exchange == "binance"
    assert candle.symbol == "BINANCE:BTCUSD"
    assert candle.time == 1700000000
    assert candle.open == 100.5
    assert candle.close == 100.8


def test_normalize_okx_row_shape():
    candle = normalize_okx_row(OKX_CANDLE_ROW, symbol_id="OKX:BTCUSD")
    assert candle.exchange == "okx"
    assert candle.symbol == "OKX:BTCUSD"
    assert candle.time == 1700000000
    assert candle.open == 100.5
    assert candle.close == 100.8


def test_binance_and_okx_candles_share_identical_field_shape():
    b = normalize_binance_row(BINANCE_KLINE_ROW, symbol_id="BINANCE:BTCUSD")
    o = normalize_okx_row(OKX_CANDLE_ROW, symbol_id="OKX:BTCUSD")
    assert set(b.model_dump().keys()) == set(o.model_dump().keys())


async def test_ticker_callback_normalizes_and_publishes():
    queue = bus.subscribe()
    try:
        callback = make_ticker_callback("binance")
        fake_ticker = FakeTicker(symbol="BTC-USDT-PERP", bid=100.0, ask=100.5, timestamp=1700000000.0)
        await callback(fake_ticker, 1700000000.0)

        event = await asyncio.wait_for(queue.get(), timeout=1)
        assert event.eventType == "MarketTick"
        assert event.symbol == "BINANCE:BTCUSD"
        assert event.exchange == "binance"
        assert event.bid == 100.0
        assert event.ask == 100.5

        stored = store.get_tick("BINANCE:BTCUSD")
        assert stored is not None
        assert stored.exchange == "binance"
    finally:
        bus.unsubscribe(queue)


async def test_candle_callback_emits_update_then_closed():
    queue = bus.subscribe()
    try:
        callback = make_candle_callback("okx")
        in_progress = FakeCandle(
            symbol="BTC-USDT-PERP", start=1700000000.0, stop=1700000059.0, interval="1m",
            open=100.0, high=101.0, low=99.0, close=100.5, volume=10.0, closed=False, timestamp=1700000030.0,
        )
        await callback(in_progress, 1700000030.0)
        update_event = await asyncio.wait_for(queue.get(), timeout=1)
        assert update_event.eventType == "CandleUpdate"
        assert update_event.symbol == "OKX:BTCUSD"
        assert update_event.exchange == "okx"

        closed = FakeCandle(
            symbol="BTC-USDT-PERP", start=1700000000.0, stop=1700000059.0, interval="1m",
            open=100.0, high=101.0, low=99.0, close=100.9, volume=15.0, closed=True, timestamp=1700000059.0,
        )
        await callback(closed, 1700000059.0)
        closed_event = await asyncio.wait_for(queue.get(), timeout=1)
        assert closed_event.eventType == "CandleClosed"
        assert closed_event.symbol == "OKX:BTCUSD"
    finally:
        bus.unsubscribe(queue)


@pytest.mark.parametrize("exchange", ["binance", "okx"])
async def test_ticker_callback_ignores_unregistered_symbol(exchange):
    callback = make_ticker_callback(exchange)
    fake_ticker = FakeTicker(symbol="DOGE-USDT-PERP", bid=1.0, ask=1.1, timestamp=1700000000.0)
    await callback(fake_ticker, 1700000000.0)  # must not raise
