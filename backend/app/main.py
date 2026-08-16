import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.credentials import router as credentials_router
from app.api.market_data import router as market_data_router
from app.api.trading import router as trading_router
from app.api.ws_gateway import router as ws_router
from app.auth.router import router as auth_router
from app.db.etf_flow_listener import run_etf_flow_listener
from app.feeds.cryptofeed_runner import run_supervised_feed

logging.basicConfig(level=logging.INFO)

_EXCHANGES = ("binance", "okx")


@asynccontextmanager
async def lifespan(app: FastAPI):
    stop_event = asyncio.Event()
    tasks = [asyncio.create_task(run_supervised_feed(exchange, stop_event)) for exchange in _EXCHANGES]
    tasks.append(asyncio.create_task(run_etf_flow_listener(stop_event)))
    try:
        yield
    finally:
        stop_event.set()
        await asyncio.gather(*tasks, return_exceptions=True)


app = FastAPI(title="Xee.Labs Market Data Backend", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(market_data_router)
app.include_router(ws_router)
app.include_router(auth_router)
app.include_router(credentials_router)
app.include_router(trading_router)


@app.get("/")
async def root() -> dict[str, str]:
    return {"status": "ok"}
