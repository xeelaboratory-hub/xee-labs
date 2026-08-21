"""In-memory latest-tick/candle/health cache. The seam a future DB replaces —
callers only see the methods below, never the underlying dicts, so swapping
this for a real persistence layer later is a drop-in replacement.
"""
from app.schemas import Candle, ExchangeHealth, Tick


class MarketDataStore:
    def __init__(self) -> None:
        self._ticks: dict[str, Tick] = {}
        self._candles: dict[tuple[str, str], Candle] = {}  # (symbol_id, timeframe) -> latest candle
        self._health: dict[str, ExchangeHealth] = {}

    def set_tick(self, tick: Tick) -> None:
        self._ticks[tick.symbol] = tick

    def get_tick(self, symbol_id: str) -> Tick | None:
        return self._ticks.get(symbol_id)

    def get_all_ticks(self) -> dict[str, Tick]:
        return dict(self._ticks)

    def set_candle(self, symbol_id: str, timeframe: str, candle: Candle) -> None:
        self._candles[(symbol_id, timeframe)] = candle

    def get_candle(self, symbol_id: str, timeframe: str) -> Candle | None:
        return self._candles.get((symbol_id, timeframe))

    def set_health(
        self, exchange: str, *, connected: bool, last_event_at: int | None, last_tick_at: int | None = None
    ) -> None:
        """None on either clock means "leave it where it was" — callers that
        can't vouch for a clock pass None rather than inventing a timestamp."""
        existing = self._health.get(exchange)
        self._health[exchange] = ExchangeHealth(
            connected=connected,
            lastEventAt=last_event_at if last_event_at is not None else (existing.lastEventAt if existing else None),
            lastTickAt=last_tick_at if last_tick_at is not None else (existing.lastTickAt if existing else None),
        )

    def get_health(self, exchange: str) -> ExchangeHealth:
        return self._health.get(exchange, ExchangeHealth(connected=False, lastEventAt=None, lastTickAt=None))


store = MarketDataStore()
