"""Picks the right REST client by exchange, normalizes raw rows into our
Candle schema, and applies a small in-memory response cache — ChartPanel's
scroll-back pagination can re-request the same range quickly while panning,
and this protects both exchanges' public rate limits against that.
"""
import time

import httpx
from fastapi import HTTPException

from app.historical import binance_klines, okx_candles
from app.schemas import Candle, CandlesMetadata
from app.symbols import SymbolInfo

from app.config import HISTORICAL_CACHE_MAX_ENTRIES, HISTORICAL_CACHE_TTL_SECONDS, SUPPORTED_TIMEFRAMES, TIMEFRAME_MAP

_MAX_LIMIT = 1500
_DEFAULT_LIMIT = 500


def _native_timeframe(exchange: str, timeframe: str) -> str:
    return TIMEFRAME_MAP.get(exchange, {}).get(timeframe, timeframe)


def normalize_binance_row(row: list, *, symbol_id: str) -> Candle:
    open_time_ms, open_, high, low, close, volume = row[0], row[1], row[2], row[3], row[4], row[5]
    return Candle(
        time=int(open_time_ms) // 1000,
        open=float(open_),
        high=float(high),
        low=float(low),
        close=float(close),
        volume=float(volume),
        timestamp=int(open_time_ms),
        exchange="binance",
        symbol=symbol_id,
    )


def normalize_okx_row(row: list, *, symbol_id: str) -> Candle:
    ts, open_, high, low, close, _vol_contracts, vol_base = row[0], row[1], row[2], row[3], row[4], row[5], row[6]
    return Candle(
        time=int(ts) // 1000,
        open=float(open_),
        high=float(high),
        low=float(low),
        close=float(close),
        volume=float(vol_base),
        timestamp=int(ts),
        exchange="okx",
        symbol=symbol_id,
    )


class _CacheEntry:
    __slots__ = ("candles", "metadata", "expires_at")

    def __init__(self, candles: list[Candle], metadata: CandlesMetadata, expires_at: float):
        self.candles = candles
        self.metadata = metadata
        self.expires_at = expires_at


_cache: dict[tuple, _CacheEntry] = {}


def _cache_key(symbol_info: SymbolInfo, timeframe: str, limit: int, from_ms: int | None, to_ms: int | None) -> tuple:
    return (symbol_info.id, timeframe, limit, from_ms, to_ms)


async def get_candles(
    symbol_info: SymbolInfo,
    *,
    timeframe: str = "1m",
    limit: int | None = None,
    from_ms: int | None = None,
    to_ms: int | None = None,
) -> tuple[list[Candle], CandlesMetadata]:
    if timeframe not in SUPPORTED_TIMEFRAMES:
        raise HTTPException(status_code=400, detail=f"unsupported timeframe: {timeframe}")

    limit = min(limit or _DEFAULT_LIMIT, _MAX_LIMIT)
    key = _cache_key(symbol_info, timeframe, limit, from_ms, to_ms)

    cached = _cache.get(key)
    now = time.monotonic()
    if cached and cached.expires_at > now:
        return cached.candles, cached.metadata

    native_tf = _native_timeframe(symbol_info.exchange, timeframe)
    try:
        if symbol_info.exchange == "binance":
            rows = await binance_klines.fetch_klines(
                symbol_info.native_symbol, interval=native_tf, limit=limit, start_ms=from_ms, end_ms=to_ms
            )
            candles = [normalize_binance_row(row, symbol_id=symbol_info.id) for row in rows]
        elif symbol_info.exchange == "okx":
            rows = await okx_candles.fetch_candles(
                symbol_info.native_symbol, bar=native_tf, limit=limit, start_ms=from_ms, end_ms=to_ms
            )
            candles = [normalize_okx_row(row, symbol_id=symbol_info.id) for row in rows]
            candles.sort(key=lambda c: c.time)  # OKX returns newest-first; normalize to ascending like Binance
        else:
            raise ValueError(f"unknown exchange: {symbol_info.exchange}")
    except (httpx.HTTPStatusError, httpx.RequestError) as exc:
        raise HTTPException(status_code=502, detail="upstream exchange error") from exc

    if from_ms is not None:
        candles = [c for c in candles if c.time * 1000 >= from_ms]
    if to_ms is not None:
        candles = [c for c in candles if c.time * 1000 <= to_ms]
    candles = candles[-limit:]

    metadata = CandlesMetadata(
        historicalCoverageStart=candles[0].time if candles else None,
        isPartial=len(candles) >= limit,
        backfillQueued=False,
    )

    _evict_if_full()
    _cache[key] = _CacheEntry(candles, metadata, now + HISTORICAL_CACHE_TTL_SECONDS)
    return candles, metadata


def _evict_if_full() -> None:
    if len(_cache) < HISTORICAL_CACHE_MAX_ENTRIES:
        return
    oldest_key = min(_cache, key=lambda k: _cache[k].expires_at)
    del _cache[oldest_key]
