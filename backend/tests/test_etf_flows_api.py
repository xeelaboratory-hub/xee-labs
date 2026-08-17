"""GET /api/market-data/etf-flows — sqlite-portable (plain SQLAlchemy Core
select, no Postgres-specific behavior). Uses httpx.AsyncClient (not
TestClient) so the request runs on the same event loop as the sqlite
StaticPool fixture -- aiosqlite connections are loop-bound.
"""
from datetime import date, datetime, timezone

import httpx
import pytest
from fastapi import FastAPI

from app.api.market_data import router
from app.db.models import EtfFlow
from app.db.session import get_db
from tests.db_test_utils import init_models, make_sessionmaker, make_test_engine


@pytest.fixture
async def client():
    engine = make_test_engine()
    await init_models(engine)
    session_factory = make_sessionmaker(engine)

    async def override_get_db():
        async with session_factory() as session:
            yield session

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = override_get_db

    async with session_factory() as session:
        session.add_all(
            [
                EtfFlow(flow_date=date(2024, 1, 11), total_net_flow=655.3, observed_at=None,
                        updated_at=datetime(2024, 1, 11, tzinfo=timezone.utc)),
                EtfFlow(flow_date=date(2024, 1, 12), total_net_flow=-43.1,
                        observed_at=datetime(2024, 1, 12, 7, tzinfo=timezone.utc),
                        updated_at=datetime(2024, 1, 12, 7, tzinfo=timezone.utc)),
                EtfFlow(flow_date=date(2024, 1, 15), total_net_flow=0.0, observed_at=None,
                        updated_at=datetime(2024, 1, 15, tzinfo=timezone.utc)),
            ]
        )
        await session.commit()

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    await engine.dispose()


async def test_no_params_returns_full_history(client):
    resp = await client.get("/api/market-data/etf-flows")
    assert resp.status_code == 200
    body = resp.json()
    assert [row["flowDate"] for row in body] == ["2024-01-11", "2024-01-12", "2024-01-15"]


async def test_from_only_returns_from_date_to_latest(client):
    resp = await client.get("/api/market-data/etf-flows", params={"from": "2024-01-12"})
    body = resp.json()
    assert [row["flowDate"] for row in body] == ["2024-01-12", "2024-01-15"]


async def test_to_only_returns_earliest_to_date(client):
    resp = await client.get("/api/market-data/etf-flows", params={"to": "2024-01-12"})
    body = resp.json()
    assert [row["flowDate"] for row in body] == ["2024-01-11", "2024-01-12"]


async def test_from_and_to_returns_range(client):
    resp = await client.get(
        "/api/market-data/etf-flows", params={"from": "2024-01-12", "to": "2024-01-12"}
    )
    body = resp.json()
    assert [row["flowDate"] for row in body] == ["2024-01-12"]


async def test_payload_shape_camelcase_and_null_observed_at(client):
    resp = await client.get("/api/market-data/etf-flows", params={"to": "2024-01-11"})
    body = resp.json()
    # sqlite drops tzinfo on round-trip (Postgres, used in production, keeps
    # it) -- assert field presence/values rather than the exact offset suffix.
    assert body == [
        {
            "flowDate": "2024-01-11",
            "totalNetFlow": 655.3,
            "observedAt": None,
            "updatedAt": "2024-01-11T00:00:00",
        }
    ]


async def test_zero_value_row_is_returned_not_omitted(client):
    resp = await client.get("/api/market-data/etf-flows", params={"from": "2024-01-15"})
    body = resp.json()
    assert len(body) == 1
    assert body[0]["totalNetFlow"] == 0.0
