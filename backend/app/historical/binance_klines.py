"""REST client: Binance USDⓈ-M futures klines. Raw rows only — normalization
happens in historical/service.py so this stays a thin, testable HTTP client.
"""
import httpx

from app.config import BINANCE_KLINES_URL

MAX_LIMIT = 1500


async def fetch_klines(
    native_symbol: str,
    *,
    interval: str,
    limit: int,
    start_ms: int | None,
    end_ms: int | None,
) -> list[list]:
    """Returns raw kline rows, ascending by open time (Binance's native order).
    Empty range (no candles in [start_ms, end_ms]) returns [] — never raises
    for that case, only for genuine HTTP/network failures.
    """
    params: dict[str, str | int] = {"symbol": native_symbol, "interval": interval, "limit": min(limit, MAX_LIMIT)}
    if start_ms is not None:
        params["startTime"] = start_ms
    if end_ms is not None:
        params["endTime"] = end_ms

    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(BINANCE_KLINES_URL, params=params)
        response.raise_for_status()
        return response.json()
