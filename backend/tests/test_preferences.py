import uuid
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI, Header

from app.api.preferences import router
from app.auth.deps import get_current_user
from app.db.session import get_db
from tests.db_test_utils import init_models, make_sessionmaker, make_test_engine


@pytest.fixture
async def preferences_client():
    engine = make_test_engine()
    await init_models(engine)
    session_factory = make_sessionmaker(engine)

    async def override_get_db():
        async with session_factory() as session:
            yield session

    async def override_current_user(x_test_user: str = Header(alias="X-Test-User")):
        return SimpleNamespace(id=uuid.UUID(x_test_user), status="active")

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_current_user

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client

    await engine.dispose()


async def test_preferences_are_isolated_per_user(preferences_client):
    user_a = str(uuid.uuid4())
    user_b = str(uuid.uuid4())
    payload = {
        "chart": {"showVolume": "true"},
        "bottomPanelCollapsed": True,
        "activeIndicators": ["ETF_FLOW"],
        "tradingMode": "demo",
    }

    saved = await preferences_client.put(
        "/api/preferences", json=payload, headers={"X-Test-User": user_a}
    )
    assert saved.status_code == 200
    assert saved.json()["preferences"] == {
        **payload,
        "timeframes": {},
        "watchlistFavorites": [],
    }

    other = await preferences_client.get(
        "/api/preferences", headers={"X-Test-User": user_b}
    )
    assert other.status_code == 200
    assert other.json()["exists"] is False

    loaded = await preferences_client.get(
        "/api/preferences", headers={"X-Test-User": user_a}
    )
    assert loaded.status_code == 200
    assert loaded.json()["exists"] is True
    assert loaded.json()["preferences"]["activeIndicators"] == ["ETF_FLOW"]


async def test_preferences_update_replaces_previous_snapshot(preferences_client):
    user_id = str(uuid.uuid4())
    headers = {"X-Test-User": user_id}
    await preferences_client.put(
        "/api/preferences", json={"rightPanelWidth": 320}, headers=headers
    )
    await preferences_client.put(
        "/api/preferences", json={"rightPanelWidth": 420}, headers=headers
    )

    loaded = await preferences_client.get("/api/preferences", headers=headers)
    assert loaded.json()["preferences"]["rightPanelWidth"] == 420


async def test_preferences_reject_unknown_or_invalid_values(preferences_client):
    headers = {"X-Test-User": str(uuid.uuid4())}
    unknown = await preferences_client.put(
        "/api/preferences", json={"secret": "nope"}, headers=headers
    )
    invalid_width = await preferences_client.put(
        "/api/preferences", json={"rightPanelWidth": 9999}, headers=headers
    )
    assert unknown.status_code == 422
    assert invalid_width.status_code == 422


async def test_preferences_require_auth():
    engine = make_test_engine()
    await init_models(engine)
    session_factory = make_sessionmaker(engine)

    async def override_get_db():
        async with session_factory() as session:
            yield session

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = override_get_db
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/preferences")
    await engine.dispose()
    assert response.status_code == 401
