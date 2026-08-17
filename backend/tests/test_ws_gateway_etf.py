"""Unit tests for `_forward_live_events`'s symbol-filtering logic — the
function touched to let global (no-`symbol`) events like EtfFlowUpdated
broadcast while preserving existing per-symbol filtering. Exercises the real
production function directly against a fake WebSocket + the real EventBus,
without going through the full /ws handshake (which needs live exchange
REST access for warmup replay — unrelated to what changed here).
"""
import asyncio
from datetime import date, datetime, timezone

import pytest

from app.api.ws_gateway import _forward_live_events, _replay_warmup
from app.bus import bus
from app.schemas import Candle, CandleClosedEvent, EtfFlowUpdatedEvent, MarketTickEvent
from app.symbols import get_symbol


class _FakeWebSocket:
    def __init__(self):
        self.sent: list[dict] = []

    async def send_json(self, data: dict) -> None:
        self.sent.append(data)


async def _forward_for_a_moment(subscribed_symbols):
    ws = _FakeWebSocket()
    task = asyncio.create_task(_forward_live_events(ws, subscribed_symbols))
    await asyncio.sleep(0.05)  # let the coroutine reach bus.subscribe() and block on queue.get()
    return ws, task


async def _stop(task):
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


def _etf_event() -> EtfFlowUpdatedEvent:
    now = datetime.now(timezone.utc)
    return EtfFlowUpdatedEvent(changeType="new", flowDate=date(2024, 1, 1), totalNetFlow=1.0, observedAt=now, updatedAt=now)


async def test_global_event_reaches_client_subscribed_to_specific_symbols():
    ws, task = await _forward_for_a_moment({"OKX:BTCUSD"})
    try:
        bus.publish(_etf_event())
        await asyncio.sleep(0.05)
        assert len(ws.sent) == 1
        assert ws.sent[0]["eventType"] == "EtfFlowUpdated"
    finally:
        await _stop(task)


async def test_global_event_reaches_client_with_no_subscription_filter():
    ws, task = await _forward_for_a_moment(None)
    try:
        bus.publish(_etf_event())
        await asyncio.sleep(0.05)
        assert len(ws.sent) == 1
    finally:
        await _stop(task)


async def test_symbol_scoped_event_still_filtered_for_non_matching_symbol():
    ws, task = await _forward_for_a_moment({"OKX:BTCUSD"})
    try:
        bus.publish(MarketTickEvent(symbol="BINANCE:ETHUSD", exchange="binance", bid=1, ask=2, occurredAt=0))
        await asyncio.sleep(0.05)
        assert ws.sent == []
    finally:
        await _stop(task)


async def test_symbol_scoped_event_still_delivered_for_matching_symbol():
    ws, task = await _forward_for_a_moment({"OKX:BTCUSD"})
    try:
        bus.publish(MarketTickEvent(symbol="OKX:BTCUSD", exchange="okx", bid=1, ask=2, occurredAt=0))
        await asyncio.sleep(0.05)
        assert len(ws.sent) == 1
        assert ws.sent[0]["eventType"] == "MarketTick"
    finally:
        await _stop(task)


async def test_candle_closed_event_still_filtered_by_symbol():
    ws, task = await _forward_for_a_moment({"OKX:BTCUSD"})
    try:
        bus.publish(CandleClosedEvent(symbol="BINANCE:ETHUSD", exchange="binance", timeframe="1m"))
        bus.publish(CandleClosedEvent(symbol="OKX:BTCUSD", exchange="okx", timeframe="1m"))
        await asyncio.sleep(0.05)
        assert len(ws.sent) == 1
        assert ws.sent[0]["symbol"] == "OKX:BTCUSD"
    finally:
        await _stop(task)


async def test_ws_warmup_sends_only_latest_candle(monkeypatch):
    info = get_symbol("BINANCE:BTCUSD")
    assert info is not None
    requested_limits: list[int] = []

    async def get_candles(_info, *, timeframe, limit):
        requested_limits.append(limit)
        return ([Candle(time=1, open=1, high=2, low=1, close=2, volume=3, timestamp=1000, exchange="binance", symbol=info.id)], None)

    monkeypatch.setattr("app.api.ws_gateway.list_symbols", lambda: [info])
    monkeypatch.setattr("app.api.ws_gateway.large_order_book_service.latest_events", lambda _symbols: [])
    monkeypatch.setattr("app.api.ws_gateway.historical_service.get_candles", get_candles)
    ws = _FakeWebSocket()

    await _replay_warmup(ws, {info.id})

    assert requested_limits == [1]
    assert [event["eventType"] for event in ws.sent] == ["CandleUpdate"]


async def test_forwarder_drains_events_queued_before_warmup_finishes():
    queue = bus.subscribe()
    bus.publish(MarketTickEvent(symbol="OKX:BTCUSD", exchange="okx", bid=1, ask=2, occurredAt=0))
    ws = _FakeWebSocket()
    task = asyncio.create_task(_forward_live_events(ws, {"OKX:BTCUSD"}, queue))
    try:
        await asyncio.sleep(0.05)
        assert [event["eventType"] for event in ws.sent] == ["MarketTick"]
    finally:
        await _stop(task)
        bus.unsubscribe(queue)
