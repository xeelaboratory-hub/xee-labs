"""REST client: OKX perpetual-swap history-candles. OKX caps this endpoint at
300 rows/request regardless of the requested `limit` (verified empirically),
so this paginates backward in time via the `after` cursor to satisfy larger
requests — unlike binance_klines.py, which covers any range in one call.
"""
import httpx

from app.config import OKX_CANDLES_URL

MAX_PAGE_SIZE = 300
MAX_PAGES = 5  # caps total fetch at 1500 rows, matching Binance's per-call ceiling


async def fetch_candles(
    native_symbol: str,
    *,
    bar: str,
    limit: int,
    start_ms: int | None,
    end_ms: int | None,
) -> list[list]:
    """Returns raw candle rows, descending by open time (OKX's native order).
    Empty range returns [] — never raises for that case, only for genuine
    HTTP/network failures.
    """
    collected: list[list] = []
    cursor = end_ms  # OKX `after` = "return records older than this ts"

    async with httpx.AsyncClient(timeout=10) as client:
        for _ in range(MAX_PAGES):
            remaining = limit - len(collected)
            if remaining <= 0:
                break
            params: dict[str, str | int] = {"instId": native_symbol, "bar": bar, "limit": min(remaining, MAX_PAGE_SIZE)}
            if cursor is not None:
                params["after"] = cursor

            response = await client.get(OKX_CANDLES_URL, params=params)
            response.raise_for_status()
            body = response.json()
            rows = body.get("data", [])
            if not rows:
                break

            collected.extend(rows)
            oldest_ts = int(rows[-1][0])
            if start_ms is not None and oldest_ts <= start_ms:
                break
            cursor = oldest_ts

    return collected
