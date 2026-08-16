"""Shared sqlite-in-memory test engine helper. A single StaticPool connection
is used so every session in a test sees the same in-memory database (plain
sqlite+aiosqlite `:memory:` gives each new connection a *separate* empty DB
otherwise). Portable model/REST-shape tests use this; Postgres-only behavior
(triggers/LISTEN/NOTIFY) cannot run against sqlite — see test_etf_flow_notify.py.
"""
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db import models  # noqa: F401 -- registers all models on Base.metadata
from app.db.base import Base


def make_test_engine():
    return create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )


async def init_models(engine) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


def make_sessionmaker(engine):
    return async_sessionmaker(engine, expire_on_commit=False)
