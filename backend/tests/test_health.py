import pytest
from fastapi.testclient import TestClient

from app.db.session import get_db
from app.main import app
from app.store import store


@pytest.fixture(autouse=True)
def _reset_feed_health():
    yield
    store._health.clear()  # test-only: don't leak feed state across tests


def test_health_returns_200_when_db_reachable():
    async def fake_ok_db():
        class _FakeSession:
            async def execute(self, *args, **kwargs):
                return None

        yield _FakeSession()

    app.dependency_overrides[get_db] = fake_ok_db
    try:
        res = TestClient(app).get("/api/health")
    finally:
        app.dependency_overrides.clear()

    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["database"] == "ok"
    assert set(body["feeds"]) == {"binance", "okx"}


def test_health_returns_503_when_database_is_unreachable():
    async def fake_broken_db():
        class _FakeSession:
            async def execute(self, *args, **kwargs):
                raise ConnectionError("could not connect to server")

        yield _FakeSession()

    app.dependency_overrides[get_db] = fake_broken_db
    try:
        res = TestClient(app).get("/api/health")
    finally:
        app.dependency_overrides.clear()

    assert res.status_code == 503
    body = res.json()
    assert body["status"] == "degraded"
    assert body["database"] == "unreachable"


def test_health_reports_current_feed_connectivity():
    store.set_health("binance", connected=True, last_event_at=1_700_000_000_000)
    store.set_health("okx", connected=False, last_event_at=None)

    async def fake_ok_db():
        class _FakeSession:
            async def execute(self, *args, **kwargs):
                return None

        yield _FakeSession()

    app.dependency_overrides[get_db] = fake_ok_db
    try:
        res = TestClient(app).get("/api/health")
    finally:
        app.dependency_overrides.clear()

    body = res.json()
    assert body["feeds"]["binance"]["connected"] is True
    assert body["feeds"]["okx"]["connected"] is False
    # A down feed degrades market data, not the container's own usability —
    # Docker's healthcheck must still see this as a 200.
    assert res.status_code == 200
