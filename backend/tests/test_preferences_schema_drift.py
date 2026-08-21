"""The preferences schema had drifted behind the UI, and the endpoint failed
hard in both directions because of it.

The frontend was sending four things the backend had never been taught:
`rightPanel: "position-builder"` and the three session-volume-profile keys.
Every PUT returned 422, so preferences never synced; and because a stored row
already held those keys, every GET returned 500 while trying to validate it —
so preference loading was broken outright rather than degraded.

These tests pin both halves: the fields are accepted, and a row this version
cannot fully parse still yields a usable response.
"""
import uuid
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI, Header

from app.api.preferences import PreferencesPayload, _read_stored, router
from app.auth.deps import get_current_user
from app.db.models import UserPreference
from app.db.session import get_db
from tests.db_test_utils import init_models, make_sessionmaker, make_test_engine


@pytest.fixture
async def client_and_sessions():
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
        yield client, session_factory

    await engine.dispose()


# ── the fields the UI was already sending ───────────────────────────────────

async def test_the_four_previously_rejected_fields_round_trip(client_and_sessions):
    client, _ = client_and_sessions
    user = str(uuid.uuid4())
    payload = {
        "chart": {},
        "timeframes": {},
        "activeIndicators": ["SESSION_VOLUME_PROFILE"],
        "watchlistFavorites": [],
        "rightPanel": "position-builder",
        "sessionVolumeProfileRows": 30,
        "sessionVolumeProfileMarket": "NEW_YORK",
        "sessionVolumeProfileMarkets": ["LONDON", "NEW_YORK"],
    }

    saved = await client.put("/api/preferences", json=payload, headers={"X-Test-User": user})
    assert saved.status_code == 200

    fetched = await client.get("/api/preferences", headers={"X-Test-User": user})
    assert fetched.status_code == 200
    prefs = fetched.json()["preferences"]
    assert prefs["rightPanel"] == "position-builder"
    assert prefs["sessionVolumeProfileRows"] == 30
    assert prefs["sessionVolumeProfileMarket"] == "NEW_YORK"
    assert prefs["sessionVolumeProfileMarkets"] == ["LONDON", "NEW_YORK"]


@pytest.mark.parametrize("rows", [10, 100])
async def test_row_counts_at_the_ui_limits_are_accepted(client_and_sessions, rows):
    """Bounds must match normalizeSessionVolumeProfileRows, which clamps 10-100."""
    client, _ = client_and_sessions
    res = await client.put(
        "/api/preferences",
        json={"sessionVolumeProfileRows": rows},
        headers={"X-Test-User": str(uuid.uuid4())},
    )
    assert res.status_code == 200


@pytest.mark.parametrize("rows", [9, 101])
async def test_row_counts_outside_the_ui_limits_are_rejected(client_and_sessions, rows):
    client, _ = client_and_sessions
    res = await client.put(
        "/api/preferences",
        json={"sessionVolumeProfileRows": rows},
        headers={"X-Test-User": str(uuid.uuid4())},
    )
    assert res.status_code == 422


async def test_writes_stay_strict_about_unknown_keys(client_and_sessions):
    """The read path is forgiving; the write path must not be, or a typo
    persists silently and is impossible to distinguish from a real setting."""
    client, _ = client_and_sessions
    res = await client.put(
        "/api/preferences",
        json={"rihgtPanel": "dom"},
        headers={"X-Test-User": str(uuid.uuid4())},
    )
    assert res.status_code == 422


# ── reading a row this version cannot fully parse ───────────────────────────

def test_unknown_keys_are_dropped_rather_than_failing_the_read():
    # Exactly the shape that returned 500 in production: a row holding keys the
    # schema had not caught up with.
    parsed = _read_stored({"tradingMode": "live", "somethingFromANewerClient": 42})

    assert parsed.tradingMode == "live"


def test_one_bad_value_does_not_cost_the_user_every_other_setting():
    parsed = _read_stored({"tradingMode": "live", "rightPanel": "no-such-panel"})

    assert parsed.tradingMode == "live"
    assert parsed.rightPanel is None


def test_a_completely_unusable_row_falls_back_to_defaults():
    parsed = _read_stored("not an object")

    assert parsed == PreferencesPayload()


async def test_get_survives_a_row_written_by_a_newer_client(client_and_sessions):
    """End-to-end version of the production failure, through the endpoint."""
    client, session_factory = client_and_sessions
    user = uuid.uuid4()
    async with session_factory() as session:
        session.add(
            UserPreference(
                user_id=user,
                preferences={"tradingMode": "live", "aFieldFromTheFuture": True},
            )
        )
        await session.commit()

    res = await client.get("/api/preferences", headers={"X-Test-User": str(user)})

    assert res.status_code == 200
    assert res.json()["preferences"]["tradingMode"] == "live"
