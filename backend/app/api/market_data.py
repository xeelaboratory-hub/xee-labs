"""REST router — matches src/services/api/market-data.ts's expected surface."""
from fastapi import APIRouter, HTTPException

from app.historical import service as historical_service
from app.schemas import CandlesRequest, CandlesResponse, HealthResponse, Symbol, Tick
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
