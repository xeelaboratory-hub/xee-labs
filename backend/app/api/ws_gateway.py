"""WS router — matches the subscribe protocol and event union `services/ws.ts`
/ `MarketDataBridge.tsx` already expect. Mounted at `/ws` to match
`vite.config.ts`'s existing (currently dead) proxy target exactly.
"""
import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.bus import bus
from app.config import WS_WARMUP_CANDLE_COUNT
from app.historical import service as historical_service
from app.schemas import CandleUpdateEvent, MarketDataEvent
from app.symbols import list_symbols

LOG = logging.getLogger("ws_gateway")
router = APIRouter()

_SUBSCRIBE_WAIT_SECONDS = 10


@router.websocket("/ws")
async def market_data_ws(websocket: WebSocket) -> None:
    await websocket.accept()

    try:
        subscribed_symbols = await _negotiate_subscription(websocket)
        await _replay_warmup(websocket, subscribed_symbols)
        await _forward_live_events(websocket, subscribed_symbols)
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
    targets = [info for info in list_symbols() if subscribed_symbols is None or info.id in subscribed_symbols]
    for info in targets:
        candles, _metadata = await historical_service.get_candles(info, timeframe="1m", limit=WS_WARMUP_CANDLE_COUNT)
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


async def _forward_live_events(websocket: WebSocket, subscribed_symbols: set[str] | None) -> None:
    queue = bus.subscribe()
    try:
        while True:
            event: MarketDataEvent = await queue.get()
            if subscribed_symbols is not None and event.symbol not in subscribed_symbols:
                continue
            await websocket.send_json(event.model_dump())
    finally:
        bus.unsubscribe(queue)
