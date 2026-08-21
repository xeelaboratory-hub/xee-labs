"""Pydantic response/event models. Mirrors the shapes `src/services/schemas.ts`
already defines client-side (CandleSchema, SymbolSchema) and the WS union
`MarketDataBridge.tsx` parses, so the frontend facade can adopt this backend
in a later phase without a payload-shape change.
"""
from datetime import date, datetime
from typing import Literal, Union

from pydantic import BaseModel, Field


class Symbol(BaseModel):
    id: str  # exchange-qualified id, e.g. "BINANCE:BTCUSD"
    name: str  # == id — frontend keys everything on `name`, so it must be unique across exchanges
    displayName: str  # e.g. "Bitcoin"
    exchange: str  # "binance" | "okx"
    category: str = "CRYPTO"
    contractSize: float = 1
    tickSize: float
    tickValue: float
    marginPercent: float
    maxLeverage: float
    commission: float = 0
    swapLong: float = 0
    swapShort: float = 0
    tradingHoursStart: str | None = None
    tradingHoursEnd: str | None = None
    isActive: bool = True


class InstrumentSpec(BaseModel):
    """Real per-instrument specs from OKX's public instruments endpoint —
    used by Position Builder for exchange-accurate sizing/liquidation math,
    unlike Symbol's static tickSize/maxLeverage placeholders above."""

    instId: str
    instType: str
    ctVal: float
    ctValCcy: str
    lotSz: float
    minSz: float
    tickSz: float
    settleCcy: str
    quoteCcy: str
    baseCcy: str
    maxLever: float


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


class EtfFlowUpdatedEvent(BaseModel):
    """Global event — no `symbol`. Farside BTC ETF daily total net flow, a pure
    context indicator; the same flow is shown on both BTC and ETH charts."""

    eventType: Literal["EtfFlowUpdated"] = "EtfFlowUpdated"
    changeType: Literal["new", "revision"]
    flowDate: date
    totalNetFlow: float
    observedAt: datetime | None = None
    updatedAt: datetime


class LargeOrderLevel(BaseModel):
    id: str
    source: Literal["binance", "okx"]
    symbol: str
    side: Literal["bid", "ask"]
    price: float
    quantity: float
    currentNotional: float
    peakNotional: float
    firstSeen: datetime
    lastSeen: datetime
    endedAt: datetime | None = None


class LargeOrderBookUpdatedEvent(BaseModel):
    eventType: Literal["LargeOrderBookUpdated"] = "LargeOrderBookUpdated"
    mode: Literal["snapshot", "delta"]
    sequence: int
    symbol: str
    source: Literal["binance", "okx"]
    levels: list[LargeOrderLevel]
    removedIds: list[str] = Field(default_factory=list)
    occurredAt: datetime


MarketDataEvent = Union[
    MarketTickEvent,
    CandleUpdateEvent,
    CandleClosedEvent,
    EtfFlowUpdatedEvent,
    LargeOrderBookUpdatedEvent,
]


class ExchangeHealth(BaseModel):
    connected: bool
    # Any traffic on the feed — ticker, candles or book. Proves the connection
    # is alive, which is what the runner's watchdog tears a feed down over.
    lastEventAt: int | None = None  # unix ms
    # Ticker events only, i.e. the last time a *price* actually arrived. A
    # dead ticker channel leaves this frozen while lastEventAt stays current;
    # that gap once mispriced a live position by $49 for 37 minutes.
    lastTickAt: int | None = None  # unix ms


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


class EtfFlow(BaseModel):
    """Farside BTC ETF daily total net flow row. `observedAt` is null for
    historical backfill rows — never invented, never coerced to a real time."""

    flowDate: date
    totalNetFlow: float
    observedAt: datetime | None = None
    updatedAt: datetime
