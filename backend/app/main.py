import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.credentials import router as credentials_router
from app.api.market_data import router as market_data_router
from app.api.preferences import router as preferences_router
from app.api.trading import router as trading_router
from app.api.ws_gateway import router as ws_router
from app.auth.router import router as auth_router
from app.db.etf_flow_listener import run_etf_flow_listener
from app.db.session import get_db
from app.feeds.cryptofeed_runner import run_supervised_feed
from app.large_order_book import service as large_order_book_service
from app.store import store
from app.validation import install_validation_error_redaction

logging.basicConfig(level=logging.INFO)
LOG = logging.getLogger("health")

_EXCHANGES = ("binance", "okx")


@asynccontextmanager
async def lifespan(app: FastAPI):
    stop_event = asyncio.Event()
    tasks = [asyncio.create_task(run_supervised_feed(exchange, stop_event)) for exchange in _EXCHANGES]
    tasks.append(asyncio.create_task(run_etf_flow_listener(stop_event)))
    tasks.append(asyncio.create_task(large_order_book_service.run(stop_event)))
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
app.include_router(preferences_router)
app.include_router(trading_router)
install_validation_error_redaction(app)


@app.get("/")
async def root() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/health")
async def health(db: Annotated[AsyncSession, Depends(get_db)]) -> JSONResponse:
    """Distinguishes "process is up" from "backend is actually usable" for
    Docker's healthcheck (see docker-compose.yml) — the previous healthcheck
    only hit `/`, which returns 200 unconditionally even with a dead
    database. Feed connectivity is reported but not a hard-fail condition:
    an exchange outage is expected/recoverable and shouldn't make Docker
    consider the container itself unhealthy (the frontend's stale-data
    banner already covers that case for users)."""
    try:
        await db.execute(text("SELECT 1"))
        database = "ok"
    except Exception as exc:
        LOG.warning("healthcheck_db_unreachable error=%s", str(exc)[:300])
        database = "unreachable"

    feeds = {exchange: store.get_health(exchange).model_dump() for exchange in _EXCHANGES}
    healthy = database == "ok"
    return JSONResponse(
        status_code=200 if healthy else 503,
        content={"status": "ok" if healthy else "degraded", "database": database, "feeds": feeds},
    )
