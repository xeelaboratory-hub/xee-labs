"""Per-exchange timeframe mapping and validation — Binance's kline intervals
are used verbatim, OKX's `bar` param capitalizes the hour/day/week suffix,
and an unsupported timeframe must be rejected with a real 4xx rather than
hitting the exchange with an arbitrary string.
"""
import pytest
from fastapi import HTTPException

from app.historical import service as historical_service
from app.historical.service import _native_timeframe
from app.symbols import get_symbol


@pytest.mark.parametrize(
    "timeframe,expected",
    [("1m", "1m"), ("5m", "5m"), ("15m", "15m"), ("30m", "30m"), ("1h", "1h"), ("4h", "4h"), ("1d", "1d"), ("1w", "1w")],
)
def test_binance_timeframe_is_identity(timeframe, expected):
    assert _native_timeframe("binance", timeframe) == expected


@pytest.mark.parametrize(
    "timeframe,expected",
    [("1m", "1m"), ("5m", "5m"), ("15m", "15m"), ("30m", "30m"), ("1h", "1H"), ("4h", "4H"), ("1d", "1D"), ("1w", "1W")],
)
def test_okx_timeframe_mapping(timeframe, expected):
    assert _native_timeframe("okx", timeframe) == expected


async def test_unsupported_timeframe_raises_400():
    symbol_info = get_symbol("BINANCE:BTCUSD")
    with pytest.raises(HTTPException) as excinfo:
        await historical_service.get_candles(symbol_info, timeframe="2m", limit=10)
    assert excinfo.value.status_code == 400


async def test_okx_receives_mapped_native_timeframe(monkeypatch):
    seen = {}

    async def fake_fetch_candles(native_symbol, *, bar, limit, start_ms, end_ms):
        seen["bar"] = bar
        return []

    monkeypatch.setattr("app.historical.okx_candles.fetch_candles", fake_fetch_candles)
    historical_service._cache.clear()

    symbol_info = get_symbol("OKX:BTCUSD")
    await historical_service.get_candles(symbol_info, timeframe="1d", limit=10)

    assert seen["bar"] == "1D"
