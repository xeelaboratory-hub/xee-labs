"""REST client: OKX public instrument specs (ctVal/lotSz/minSz/tickSz/lever).
Unauthenticated GET — no API keys needed, unlike OKXClient (which always
signs requests with account credentials). Instrument specs change rarely
(new contracts, occasional tick-size revisions), so results are cached
in-memory with a long TTL, same pattern as historical/service.py's candle
cache but keyed by (inst_id, inst_type) and much longer-lived.
"""
import time

import httpx

from app.config import INSTRUMENT_CACHE_TTL_SECONDS, OKX_INSTRUMENTS_URL


class _CacheEntry:
    __slots__ = ("instrument", "expires_at")

    def __init__(self, instrument: dict | None, expires_at: float):
        self.instrument = instrument
        self.expires_at = expires_at


_cache: dict[tuple[str, str], _CacheEntry] = {}


async def fetch_instrument(inst_id: str, inst_type: str) -> dict | None:
    """Returns the raw OKX instrument dict (data[0]) or None if OKX returns
    no match for this instId/instType pair. Raises only on genuine HTTP/
    network failure (mirrors okx_candles.fetch_candles).
    """
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(
            OKX_INSTRUMENTS_URL, params={"instType": inst_type, "instId": inst_id}
        )
        response.raise_for_status()
        rows = response.json().get("data", [])
    return rows[0] if rows else None


async def get_instrument_cached(inst_id: str, inst_type: str) -> dict | None:
    """Cached wrapper around fetch_instrument — a None result (unknown
    instrument) is cached too, so a bad symbol doesn't hammer OKX on every
    request."""
    key = (inst_id, inst_type)
    cached = _cache.get(key)
    now = time.monotonic()
    if cached and cached.expires_at > now:
        return cached.instrument

    instrument = await fetch_instrument(inst_id, inst_type)
    _cache[key] = _CacheEntry(instrument, now + INSTRUMENT_CACHE_TTL_SECONDS)
    return instrument
