import logging

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth.deps import get_current_user
from app.auth.rate_limit import ACCOUNT_LOGIN_LIMITER, LOGIN_LIMITER, REGISTER_LIMITER
from app.auth.router import router as auth_router
from app.db.session import get_db
from app.exchange.errors import ExchangeError
from app.main import app
from tests.db_test_utils import init_models, make_sessionmaker, make_test_engine


@pytest.fixture(autouse=True)
def _reset_limiters():
    LOGIN_LIMITER.reset()
    ACCOUNT_LOGIN_LIMITER.reset()
    REGISTER_LIMITER.reset()
    yield
    LOGIN_LIMITER.reset()
    ACCOUNT_LOGIN_LIMITER.reset()
    REGISTER_LIMITER.reset()


@pytest.fixture
async def auth_client():
    engine = make_test_engine()
    await init_models(engine)
    session_factory = make_sessionmaker(engine)

    async def override_get_db():
        async with session_factory() as session:
            yield session

    test_app = FastAPI()
    test_app.include_router(auth_router)
    test_app.dependency_overrides[get_db] = override_get_db

    transport = httpx.ASGITransport(app=test_app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client

    await engine.dispose()


async def test_failed_login_is_logged_without_the_password(auth_client, caplog):
    with caplog.at_level(logging.WARNING, logger="auth"):
        response = await auth_client.post(
            "/api/auth/login",
            json={"email": "nobody@example.com", "password": "super-secret-guess"},
        )
    assert response.status_code == 401
    assert len(caplog.records) == 1
    message = caplog.records[0].getMessage()
    assert "login_failed" in message
    assert "nobody@example.com" in message
    assert "super-secret-guess" not in message


async def test_rate_limit_block_is_logged(auth_client, caplog):
    with caplog.at_level(logging.WARNING, logger="auth"):
        for _ in range(6):
            response = await auth_client.post(
                "/api/auth/login", json={"email": "nobody@example.com", "password": "wrong"}
            )
    assert response.status_code == 429
    rate_limit_logs = [r.getMessage() for r in caplog.records if "rate_limited" in r.getMessage()]
    assert len(rate_limit_logs) == 1
    assert "limiter=login_ip" in rate_limit_logs[0]


class _FakeUser:
    id = "u-internal-42"
    status = "active"


class _RaisingOKXClient:
    async def place_order(self, **kwargs):
        raise ExchangeError("Insufficient balance", code="51000")


def test_exchange_error_on_place_order_is_logged_without_secrets(monkeypatch, caplog):
    app.dependency_overrides[get_current_user] = lambda: _FakeUser()

    async def fake_get_client(mode, user, db):
        return _RaisingOKXClient()

    monkeypatch.setattr("app.api.trading._get_okx_client", fake_get_client)

    try:
        with caplog.at_level(logging.WARNING, logger="trading"):
            res = TestClient(app).post(
                "/api/orders",
                params={"mode": "demo"},
                json={"symbol": "OKX:BTCUSD", "side": "BUY", "type": "MARKET", "quantity": 1},
            )
    finally:
        app.dependency_overrides.clear()

    assert res.status_code == 502
    assert len(caplog.records) == 1
    message = caplog.records[0].getMessage()
    assert "exchange_error" in message
    assert "operation=place_order" in message
    assert "exchange=okx" in message
    assert "user_id=u-internal-42" in message
    assert "code=51000" in message
    assert "Insufficient balance" in message
    for secret_marker in ("api_key", "api_secret", "passphrase", "Bearer"):
        assert secret_marker not in message
