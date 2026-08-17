"""REST router — matches src/services/api/market-data.ts's expected surface."""
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import EtfFlow as EtfFlowModel, LargeOrderLevel as LargeOrderLevelModel
from app.db.session import get_db
from app.historical import service as historical_service
from app.schemas import CandlesRequest, CandlesResponse, EtfFlow, HealthResponse, LargeOrderLevel, Symbol, Tick
from app.store import store
from app.symbols import get_symbol, list_symbols

router = APIRouter(prefix="/api/market-data")


@router.get("/symbols", response_model=list[Symbol])
async def get_symbols() -> list[Symbol]:
    return [info.to_schema() for info in list_symbols()]


@router.post("/candles/{symbol}", response_model=CandlesResponse)
async def get_candles(symbol: str, body: CandlesRequest | None = None) -> CandlesResponse:
    symbol_info = get_symbol(symbol)
    if symbol_info is None:
        raise HTTPException(status_code=404, detail=f"unknown symbol: {symbol}")

    body = body or CandlesRequest()
    candles, metadata = await historical_service.get_candles(
        symbol_info,
        timeframe=body.timeframe,
        limit=body.limit,
        from_ms=body.from_,
        to_ms=body.to,
    )
    return CandlesResponse(candles=candles, metadata=metadata)


@router.get("/ticks/{symbol}", response_model=Tick)
async def get_tick(symbol: str) -> Tick:
    if get_symbol(symbol) is None:
        raise HTTPException(status_code=404, detail=f"unknown symbol: {symbol}")
    tick = store.get_tick(symbol)
    if tick is None:
        raise HTTPException(status_code=404, detail=f"no tick yet for symbol: {symbol}")
    return tick


@router.get("/ticks", response_model=dict[str, Tick])
async def get_ticks() -> dict[str, Tick]:
    return store.get_all_ticks()


@router.get("/health", response_model=HealthResponse)
async def get_health() -> HealthResponse:
    return HealthResponse(binance=store.get_health("binance"), okx=store.get_health("okx"))


@router.get("/etf-flows", response_model=list[EtfFlow])
async def get_etf_flows(
    from_: date | None = Query(default=None, alias="from"),
    to: date | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> list[EtfFlow]:
    stmt = select(EtfFlowModel).order_by(EtfFlowModel.flow_date)
    if from_ is not None:
        stmt = stmt.where(EtfFlowModel.flow_date >= from_)
    if to is not None:
        stmt = stmt.where(EtfFlowModel.flow_date <= to)
    rows = (await db.execute(stmt)).scalars().all()
    return [
        EtfFlow(
            flowDate=row.flow_date,
            totalNetFlow=float(row.total_net_flow),
            observedAt=row.observed_at,
            updatedAt=row.updated_at,
        )
        for row in rows
    ]


@router.get("/large-order-book/history", response_model=list[LargeOrderLevel])
async def get_large_order_book_history(
    base: Literal["BTC", "ETH"],
    source: list[Literal["binance", "okx"]] = Query(default=["binance", "okx"]),
    threshold: int = Query(default=1_000_000, ge=0, le=10_000_000),
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = Query(default=None),
    limit: int = Query(default=1000, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
) -> list[LargeOrderLevel]:
    now = datetime.now(timezone.utc)
    start = max(from_ or now - timedelta(days=30), now - timedelta(days=30))
    end = to or now
    symbols = [f"{exchange.upper()}:{base}USD" for exchange in source]
    stmt = (
        select(LargeOrderLevelModel)
        .where(
            LargeOrderLevelModel.symbol.in_(symbols),
            LargeOrderLevelModel.source.in_(source),
            LargeOrderLevelModel.peak_notional >= threshold,
            LargeOrderLevelModel.first_seen <= end,
            (LargeOrderLevelModel.ended_at.is_(None) | (LargeOrderLevelModel.ended_at >= start)),
        )
    )
    stmt = stmt.order_by(LargeOrderLevelModel.first_seen.desc()).limit(limit)
    try:
        rows = (await db.execute(stmt)).scalars().all()
    except Exception as exc:
        raise HTTPException(status_code=503, detail="large-order history unavailable") from exc
    return [
        LargeOrderLevel(
            id=str(row.id),
            source=row.source,
            symbol=row.symbol,
            side=row.side,
            price=float(row.price),
            quantity=float(row.quantity),
            currentNotional=float(row.current_notional),
            peakNotional=float(row.peak_notional),
            firstSeen=row.first_seen,
            lastSeen=row.last_seen,
            endedAt=row.ended_at,
        )
        for row in rows
    ]
