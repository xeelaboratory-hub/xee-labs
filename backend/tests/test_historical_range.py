"""Range pagination edge cases for historical/service.py — this is the
contract ChartPanel's scroll-back pagination depends on: from/to must be
honored exactly, "no data in range" must return [] rather than raising, and
identical requests must hit the response cache instead of re-fetching.
"""
from app.historical import service as historical_service
from app.symbols import get_symbol

BINANCE_ROWS = [
    [1700000000000, "1", "1", "1", "1", "1", 1700000059999, "1", 1, "1", "1", "0"],
    [1700000060000, "2", "2", "2", "2", "2", 1700000119999, "1", 1, "1", "1", "0"],
    [1700000120000, "3", "3", "3", "3", "3", 1700000179999, "1", 1, "1", "1", "0"],
]

OKX_ROWS_DESCENDING = [
    ["1700000120000", "3", "3", "3", "3", "3", "3", "3", "1"],
    ["1700000060000", "2", "2", "2", "2", "2", "2", "2", "1"],
    ["1700000000000", "1", "1", "1", "1", "1", "1", "1", "1"],
]


async def test_empty_range_returns_empty_list_not_error(monkeypatch):
    async def fake_fetch_klines(native_symbol, *, interval, limit, start_ms, end_ms):
        return []

    monkeypatch.setattr("app.historical.binance_klines.fetch_klines", fake_fetch_klines)
    historical_service._cache.clear()

    symbol_info = get_symbol("BINANCE:BTCUSD")
    candles, metadata = await historical_service.get_candles(symbol_info, timeframe="1m", limit=100, from_ms=0, to_ms=1)

    assert candles == []
    assert metadata.historicalCoverageStart is None
    assert metadata.isPartial is False
    assert metadata.backfillQueued is False


async def test_range_filters_candles_outside_from_to(monkeypatch):
    async def fake_fetch_klines(native_symbol, *, interval, limit, start_ms, end_ms):
        return BINANCE_ROWS

    monkeypatch.setattr("app.historical.binance_klines.fetch_klines", fake_fetch_klines)
    historical_service._cache.clear()

    symbol_info = get_symbol("BINANCE:BTCUSD")
    candles, _metadata = await historical_service.get_candles(
        symbol_info, timeframe="1m", limit=100, from_ms=1700000060000, to_ms=1700000060000
    )

    assert [c.time for c in candles] == [1700000060]


async def test_okx_rows_are_normalized_to_ascending_order(monkeypatch):
    async def fake_fetch_candles(native_symbol, *, bar, limit, start_ms, end_ms):
        return OKX_ROWS_DESCENDING

    monkeypatch.setattr("app.historical.okx_candles.fetch_candles", fake_fetch_candles)
    historical_service._cache.clear()

    symbol_info = get_symbol("OKX:BTCUSD")
    candles, _metadata = await historical_service.get_candles(symbol_info, timeframe="1m", limit=100)

    assert [c.time for c in candles] == [1700000000, 1700000060, 1700000120]


async def test_result_count_at_limit_marks_partial():
    async def fake_fetch_klines(native_symbol, *, interval, limit, start_ms, end_ms):
        return BINANCE_ROWS

    import app.historical.binance_klines as binance_klines_module

    original = binance_klines_module.fetch_klines
    binance_klines_module.fetch_klines = fake_fetch_klines
    historical_service._cache.clear()
    try:
        symbol_info = get_symbol("BINANCE:BTCUSD")
        candles, metadata = await historical_service.get_candles(symbol_info, timeframe="1m", limit=3)
        assert len(candles) == 3
        assert metadata.isPartial is True
        assert metadata.historicalCoverageStart == candles[0].time
    finally:
        binance_klines_module.fetch_klines = original


async def test_identical_requests_are_served_from_cache(monkeypatch):
    call_count = {"n": 0}

    async def fake_fetch_klines(native_symbol, *, interval, limit, start_ms, end_ms):
        call_count["n"] += 1
        return []

    monkeypatch.setattr("app.historical.binance_klines.fetch_klines", fake_fetch_klines)
    historical_service._cache.clear()

    symbol_info = get_symbol("BINANCE:BTCUSD")
    await historical_service.get_candles(symbol_info, timeframe="1m", limit=50)
    await historical_service.get_candles(symbol_info, timeframe="1m", limit=50)

    assert call_count["n"] == 1
