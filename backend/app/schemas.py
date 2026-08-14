"""Pydantic response/event models. Mirrors the shapes `src/services/schemas.ts`
already defines client-side (CandleSchema, SymbolSchema) and the WS union
`MarketDataBridge.tsx` parses, so the frontend facade can adopt this backend
in a later phase without a payload-shape change.
"""
from typing import Literal, Union

from pydantic import BaseModel, Field


class Symbol(BaseModel):
    id: str  # exchange-qualified id, e.g. "BINANCE:BTCUSD"
    name: str  # e.g. "BTCUSD"
    displayName: str  # e.g. "Bitcoin"
    exchange: str  # "binance" | "okx"
    category: str = "CRYPTO"
    isActive: bool = True


class Candle(BaseModel):
    time: int  # unix seconds
    open: float
    high: float
    low: float
    close: float
    volume: float
    timestamp: int | None = None
    exchange: str
    symbol: str


class Tick(BaseModel):
    symbol: str
    exchange: str
    bid: float
    ask: float
    occurredAt: int  # unix ms


class MarketTickEvent(BaseModel):
    eventType: Literal["MarketTick"] = "MarketTick"
    symbol: str
    exchange: str
    bid: float
    ask: float
    occurredAt: int


class CandleUpdateEvent(BaseModel):
    eventType: Literal["CandleUpdate"] = "CandleUpdate"
    symbol: str
    exchange: str
    timeframe: str
    open: float
    high: float
    low: float
    close: float
    volume: float
    timestamp: int


class CandleClosedEvent(BaseModel):
    eventType: Literal["CandleClosed"] = "CandleClosed"
    symbol: str
    exchange: str
    timeframe: str


MarketDataEvent = Union[MarketTickEvent, CandleUpdateEvent, CandleClosedEvent]


class ExchangeHealth(BaseModel):
    connected: bool
    lastEventAt: int | None = None  # unix ms


class HealthResponse(BaseModel):
    binance: ExchangeHealth
    okx: ExchangeHealth


class CandlesRequest(BaseModel):
    timeframe: str = "1m"
    limit: int | None = Field(default=500, gt=0, le=1500)
    from_: int | None = Field(default=None, alias="from")  # unix ms
    to: int | None = None  # unix ms

    model_config = {"populate_by_name": True}


class CandlesMetadata(BaseModel):
    historicalCoverageStart: int | None
    isPartial: bool
    backfillQueued: bool = False


class CandlesResponse(BaseModel):
    candles: list[Candle]
    metadata: CandlesMetadata
