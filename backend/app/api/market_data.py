"""REST router — matches src/services/api/market-data.ts's expected surface."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import EtfFlow as EtfFlowModel
from app.db.session import get_db
from app.historical import service as historical_service
from app.schemas import CandlesRequest, CandlesResponse, EtfFlow, HealthResponse, Symbol, Tick
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
