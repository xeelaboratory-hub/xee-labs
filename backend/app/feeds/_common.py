"""Shared raw->normalized callback logic used by both feeds/binance.py and
feeds/okx.py — CryptoFeed's Ticker/Candle payload shape is exchange-agnostic
by the time it reaches a callback, so only the Feed construction (symbols,
exchange class) differs per exchange, not this mapping.
"""
import time
from datetime import datetime, timezone

from app.bus import bus
from app.schemas import Candle, CandleClosedEvent, CandleUpdateEvent, MarketTickEvent, Tick
from app.large_order_book import service as large_order_book_service
from app.store import store
from app.symbols import resolve_from_feed


def make_ticker_callback(exchange: str):
    async def _on_ticker(ticker, receipt_timestamp: float) -> None:
        info = resolve_from_feed(exchange, ticker.symbol)
        if info is None:
            return
        occurred_at_ms = int((ticker.timestamp or receipt_timestamp) * 1000)
        tick = Tick(symbol=info.id, exchange=exchange, bid=float(ticker.bid), ask=float(ticker.ask), occurredAt=occurred_at_ms)
        store.set_tick(tick)
        # The ticker is the only callback that advances the freshness clock:
        # it is the sole writer of store.set_tick, so it alone proves prices
        # are still flowing. The runner's watchdog and the frontend's
        # stale-data banner both read this timestamp.
        store.set_health(exchange, connected=True, last_event_at=occurred_at_ms)
        bus.publish(MarketTickEvent(symbol=tick.symbol, exchange=exchange, bid=tick.bid, ask=tick.ask, occurredAt=tick.occurredAt))

    return _on_ticker


def make_candle_callback(exchange: str):
    async def _on_candle(candle, receipt_timestamp: float) -> None:
        info = resolve_from_feed(exchange, candle.symbol)
        if info is None:
            return
        event_ms = int((candle.timestamp or receipt_timestamp) * 1000)
        normalized = Candle(
            time=int(candle.start),
            open=float(candle.open),
            high=float(candle.high),
            low=float(candle.low),
            close=float(candle.close),
            volume=float(candle.volume),
            timestamp=event_ms,
            exchange=exchange,
            symbol=info.id,
        )
        store.set_candle(info.id, candle.interval, normalized)
        # Affirm the connection without advancing the freshness clock — that
        # clock tracks *prices*, and candles kept it green while the ticker
        # channel was dead, hiding a 37-minute-stale price behind a healthy
        # status. See the note on the ticker callback above.
        store.set_health(exchange, connected=True, last_event_at=None)

        if candle.closed:
            bus.publish(CandleClosedEvent(symbol=info.id, exchange=exchange, timeframe=candle.interval))
        else:
            bus.publish(
                CandleUpdateEvent(
                    symbol=info.id,
                    exchange=exchange,
                    timeframe=candle.interval,
                    open=normalized.open,
                    high=normalized.high,
                    low=normalized.low,
                    close=normalized.close,
                    volume=normalized.volume,
                    timestamp=event_ms,
                )
            )

    return _on_candle


def make_book_callback(exchange: str):
    async def _on_book(book, receipt_timestamp: float) -> None:
        info = resolve_from_feed(exchange, book.symbol)
        if info is None:
            return
        timestamp = book.timestamp or receipt_timestamp
        occurred_at = datetime.fromtimestamp(timestamp, tz=timezone.utc)
        if book.delta is None:
            large_order_book_service.process_book(exchange, info, book.book, occurred_at)
        else:
            large_order_book_service.process_delta(exchange, info, book.delta, occurred_at)
        # As with candles: connection alive, but book depth is not a price
        # quote, so it must not vouch for tick freshness.
        store.set_health(exchange, connected=True, last_event_at=None)

    return _on_book


def now_ms() -> int:
    return int(time.time() * 1000)
