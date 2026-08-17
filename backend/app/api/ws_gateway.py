"""WS router — matches the subscribe protocol and event union `services/ws.ts`
/ `MarketDataBridge.tsx` already expect. Mounted at `/ws` to match
`vite.config.ts`'s existing (currently dead) proxy target exactly.
"""
import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.bus import bus
from app.historical import service as historical_service
from app.schemas import CandleUpdateEvent, MarketDataEvent
from app.large_order_book import service as large_order_book_service
from app.symbols import list_symbols

LOG = logging.getLogger("ws_gateway")
router = APIRouter()

_SUBSCRIBE_WAIT_SECONDS = 10


@router.websocket("/ws")
async def market_data_ws(websocket: WebSocket) -> None:
    await websocket.accept()

    try:
        subscribed_symbols = await _negotiate_subscription(websocket)
        queue = bus.subscribe()
        try:
            await _replay_warmup(websocket, subscribed_symbols)
            await _forward_live_events(websocket, subscribed_symbols, queue)
        finally:
            bus.unsubscribe(queue)
    except WebSocketDisconnect:
        LOG.info("client disconnected")


async def _negotiate_subscription(websocket: WebSocket) -> set[str] | None:
    """Returns the set of symbol ids to forward, or None for "all symbols"."""
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=_SUBSCRIBE_WAIT_SECONDS)
    except (asyncio.TimeoutError, WebSocketDisconnect):
        return None

    try:
        message = json.loads(raw)
    except json.JSONDecodeError:
        return None

    if message.get("action") != "subscribe":
        return None

    symbols = message.get("symbols")
    await websocket.send_json({"action": "subscribed", "channel": "market-data", "symbols": symbols or "all"})
    return set(symbols) if symbols else None


async def _replay_warmup(websocket: WebSocket, subscribed_symbols: set[str] | None) -> None:
    # Replay active order-book state before candle warmup so the panel is
    # populated immediately.
    for event in large_order_book_service.latest_events(subscribed_symbols):
        await websocket.send_json(event.model_dump(mode="json"))
    targets = [info for info in list_symbols() if subscribed_symbols is None or info.id in subscribed_symbols]
    for info in targets:
        # The client stores only the latest live candle per symbol/timeframe;
        # replaying hundreds of overwritten candles creates a React update storm.
        candles, _metadata = await historical_service.get_candles(info, timeframe="1m", limit=1)
        for candle in candles:
            event = CandleUpdateEvent(
                symbol=info.id,
                exchange=info.exchange,
                timeframe="1m",
                open=candle.open,
                high=candle.high,
                low=candle.low,
                close=candle.close,
                volume=candle.volume,
                timestamp=candle.timestamp or candle.time * 1000,
            )
            await websocket.send_json(event.model_dump())


async def _forward_live_events(
    websocket: WebSocket,
    subscribed_symbols: set[str] | None,
    queue: asyncio.Queue | None = None,
) -> None:
    owns_queue = queue is None
    queue = queue or bus.subscribe()
    try:
        while True:
            event: MarketDataEvent = await queue.get()
            # Events with a `symbol` (MarketTick/CandleUpdate/CandleClosed) keep
            # today's per-symbol filtering unchanged. Global events with no
            # `symbol` at all (e.g. EtfFlowUpdated) always broadcast — no fake
            # symbol is invented to route them through the existing filter.
            event_symbol = getattr(event, "symbol", None)
            if subscribed_symbols is not None and event_symbol is not None and event_symbol not in subscribed_symbols:
                continue
            # mode="json" so date/datetime fields (EtfFlowUpdatedEvent's
            # flowDate/observedAt/updatedAt) serialize to ISO strings instead
            # of raw Python objects that json.dumps can't encode.
            await websocket.send_json(event.model_dump(mode="json"))
    finally:
        if owns_queue:
            bus.unsubscribe(queue)
