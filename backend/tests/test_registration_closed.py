"""Self-service registration is closed unless an instance asks for it.

The reason is exposure, not policy: the frontend container publishes :8080 on
every interface and nginx proxies `/api` to the backend, so `/api/auth/register`
is reachable from anything on the local network. This instance serves one
operator account. An open signup endpoint is a path from "someone on the
network" to "authenticated user" that nothing here needs yet.
"""
import httpx
import pytest
from fastapi import FastAPI

from app import config
from app.auth.rate_limit import REGISTER_LIMITER
from app.auth.router import router
from app.db.session import get_db
from tests.db_test_utils import init_models, make_sessionmaker, make_test_engine

_SIGNUP = {
    "email": "stranger@example.com",
    "password": "hunter2hunter2",
    "firstName": "A",
    "lastName": "B",
}


@pytest.fixture(autouse=True)
def _reset_limiter():
    REGISTER_LIMITER.reset()
    yield
    REGISTER_LIMITER.reset()


@pytest.fixture
async def auth_client():
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
        yield client

    await engine.dispose()


# ── The flag itself ────────────────────────────────────────────────────────


@pytest.mark.parametrize("value", ["true", "TRUE", "True", "1", "yes", "on", " true "])
def test_explicit_affirmatives_open_registration(monkeypatch, value):
    monkeypatch.setenv("REGISTRATION_OPEN", value)
    assert config._env_flag("REGISTRATION_OPEN") is True


@pytest.mark.parametrize("value", ["", "false", "0", "no", "off", "maybe", "ture"])
def test_everything_else_leaves_it_closed(monkeypatch, value):
    """Including typos. A misspelled value must not be what opens signup."""
    monkeypatch.setenv("REGISTRATION_OPEN", value)
    assert config._env_flag("REGISTRATION_OPEN") is False


def test_an_unset_variable_leaves_it_closed(monkeypatch):
    """The default is the whole point: an instance that was never configured
    for signup must not accept it."""
    monkeypatch.delenv("REGISTRATION_OPEN", raising=False)
    assert config._env_flag("REGISTRATION_OPEN") is False


# ── The endpoint ───────────────────────────────────────────────────────────


async def test_registration_is_refused_when_closed(auth_client, monkeypatch):
    monkeypatch.setattr(config, "REGISTRATION_OPEN", False)
    res = await auth_client.post("/api/auth/register", json=_SIGNUP)
    assert res.status_code == 403
    assert "closed" in res.json()["detail"]


async def test_registration_works_when_opened(auth_client, open_registration):
    res = await auth_client.post("/api/auth/register", json=_SIGNUP)
    assert res.status_code == 200
    assert res.json()["user"]["email"] == _SIGNUP["email"]


async def test_no_account_is_created_while_closed(auth_client, monkeypatch):
    """A 403 that still wrote a user row would be worse than no check at all."""
    monkeypatch.setattr(config, "REGISTRATION_OPEN", False)
    await auth_client.post("/api/auth/register", json=_SIGNUP)

    monkeypatch.setattr(config, "REGISTRATION_OPEN", True)
    res = await auth_client.post("/api/auth/register", json=_SIGNUP)
    # 409 here would mean the refused attempt had persisted the account.
    assert res.status_code == 200


async def test_a_refused_signup_does_not_consume_the_rate_limit(auth_client, monkeypatch):
    """The guard runs before the limiter, so someone hammering a closed
    endpoint can't exhaust the budget that protects an open one."""
    monkeypatch.setattr(config, "REGISTRATION_OPEN", False)
    for _ in range(5):  # over the 3/60s register limit
        assert (await auth_client.post("/api/auth/register", json=_SIGNUP)).status_code == 403

    monkeypatch.setattr(config, "REGISTRATION_OPEN", True)
    assert (await auth_client.post("/api/auth/register", json=_SIGNUP)).status_code == 200


async def test_login_still_works_with_registration_closed(auth_client, monkeypatch):
    """Closing signup must not close the door on the account that exists."""
    monkeypatch.setattr(config, "REGISTRATION_OPEN", True)
    await auth_client.post("/api/auth/register", json=_SIGNUP)

    monkeypatch.setattr(config, "REGISTRATION_OPEN", False)
    res = await auth_client.post(
        "/api/auth/login", json={"email": _SIGNUP["email"], "password": _SIGNUP["password"]}
    )
    assert res.status_code == 200
    assert res.json()["accessToken"]
