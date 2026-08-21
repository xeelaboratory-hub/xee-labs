import httpx
import pytest
from fastapi import FastAPI

from app.auth.rate_limit import ACCOUNT_LOGIN_LIMITER, LOGIN_LIMITER, REGISTER_LIMITER
from app.auth.router import router
from app.db.session import get_db
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

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = override_get_db

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client

    await engine.dispose()


async def test_login_allows_up_to_the_limit_then_429s(auth_client):
    for _ in range(5):
        response = await auth_client.post(
            "/api/auth/login", json={"email": "nobody@example.com", "password": "wrong"}
        )
        # Wrong/unknown credentials — allowed through the limiter, rejected by auth (401).
        assert response.status_code == 401

    blocked = await auth_client.post(
        "/api/auth/login", json={"email": "nobody@example.com", "password": "wrong"}
    )
    assert blocked.status_code == 429
    assert "Retry-After" in blocked.headers


async def test_login_rate_limit_does_not_leak_whether_the_account_exists(auth_client):
    await auth_client.post(
        "/api/auth/register",
        json={"email": "real@example.com", "password": "hunter22", "firstName": "A", "lastName": "B"},
    )

    for _ in range(5):
        await auth_client.post(
            "/api/auth/login", json={"email": "real@example.com", "password": "wrong"}
        )
    blocked_existing = await auth_client.post(
        "/api/auth/login", json={"email": "real@example.com", "password": "wrong"}
    )

    for _ in range(5):
        await auth_client.post(
            "/api/auth/login", json={"email": "ghost@example.com", "password": "wrong"}
        )
    blocked_ghost = await auth_client.post(
        "/api/auth/login", json={"email": "ghost@example.com", "password": "wrong"}
    )

    assert blocked_existing.status_code == blocked_ghost.status_code == 429
    assert blocked_existing.json() == blocked_ghost.json()


async def test_login_rate_limit_is_scoped_per_ip(auth_client):
    for _ in range(5):
        await auth_client.post(
            "/api/auth/login",
            json={"email": "nobody@example.com", "password": "wrong"},
            headers={"X-Forwarded-For": "1.1.1.1"},
        )
    still_blocked = await auth_client.post(
        "/api/auth/login",
        json={"email": "nobody@example.com", "password": "wrong"},
        headers={"X-Forwarded-For": "1.1.1.1"},
    )
    other_ip = await auth_client.post(
        "/api/auth/login",
        json={"email": "nobody@example.com", "password": "wrong"},
        headers={"X-Forwarded-For": "2.2.2.2"},
    )

    assert still_blocked.status_code == 429
    assert other_ip.status_code == 401  # fresh bucket for a different IP


async def test_account_limiter_blocks_the_same_email_spread_across_many_ips(auth_client):
    for i in range(8):
        response = await auth_client.post(
            "/api/auth/login",
            json={"email": "victim@example.com", "password": "wrong"},
            headers={"X-Forwarded-For": f"10.0.{i}.1"},
        )
        # Each attempt comes from a fresh IP, so the IP limiter never trips —
        # only the account limiter is accumulating here.
        assert response.status_code == 401

    blocked = await auth_client.post(
        "/api/auth/login",
        json={"email": "victim@example.com", "password": "wrong"},
        headers={"X-Forwarded-For": "10.0.99.1"},
    )
    assert blocked.status_code == 429
    assert "Retry-After" in blocked.headers


async def test_ip_limiter_still_applies_across_different_emails(auth_client):
    for i in range(5):
        response = await auth_client.post(
            "/api/auth/login",
            json={"email": f"person{i}@example.com", "password": "wrong"},
            headers={"X-Forwarded-For": "9.9.9.9"},
        )
        assert response.status_code == 401

    blocked = await auth_client.post(
        "/api/auth/login",
        json={"email": "yet-another@example.com", "password": "wrong"},
        headers={"X-Forwarded-For": "9.9.9.9"},
    )
    assert blocked.status_code == 429


async def test_account_key_normalizes_email_case_and_whitespace(auth_client):
    casings = ["Victim@Example.com", "victim@example.com", " VICTIM@EXAMPLE.COM "]
    for i in range(8):
        response = await auth_client.post(
            "/api/auth/login",
            json={"email": casings[i % len(casings)], "password": "wrong"},
            headers={"X-Forwarded-For": f"10.1.{i}.1"},
        )
        assert response.status_code == 401

    blocked = await auth_client.post(
        "/api/auth/login",
        json={"email": "victim@example.com", "password": "wrong"},
        headers={"X-Forwarded-For": "10.1.99.1"},
    )
    assert blocked.status_code == 429


async def test_untrusted_peer_cannot_spoof_x_forwarded_for_to_dodge_the_ip_limit(auth_client):
    # httpx's ASGITransport reports a loopback peer (private) for every call,
    # which real nginx-proxied traffic also looks like from the backend's
    # side. Directly exercise the trust decision itself instead.
    from app.auth.rate_limit import _is_trusted_proxy_peer

    assert _is_trusted_proxy_peer("127.0.0.1") is True  # nginx-in-docker-like peer
    assert _is_trusted_proxy_peer("172.18.0.5") is True  # typical docker bridge subnet
    assert _is_trusted_proxy_peer("8.8.8.8") is False  # a direct public-internet hit
    assert _is_trusted_proxy_peer("not-an-ip") is False


async def testclient_ip_ignores_forwarded_header_from_a_public_peer():
    # Simulates hitting the backend's published :3000 port directly, bypassing
    # nginx — docker-compose.yml publishes it alongside nginx's :8080 (see
    # AGENTS.md). The forged header must be ignored; the real socket peer
    # (not attacker-controlled) is used instead.
    from starlette.requests import Request

    from app.auth.rate_limit import client_ip

    def make_request(peer: str, forwarded_for: str) -> Request:
        scope = {
            "type": "http",
            "client": (peer, 12345),
            "headers": [(b"x-forwarded-for", forwarded_for.encode())],
        }
        return Request(scope)

    public_peer_request = make_request("8.8.8.8", "1.1.1.1")
    assert client_ip(public_peer_request) == "8.8.8.8"  # header ignored

    proxied_request = make_request("172.18.0.5", "1.1.1.1")
    assert client_ip(proxied_request) == "1.1.1.1"  # header trusted from a docker-internal peer


async def test_register_allows_up_to_the_limit_then_429s(auth_client, open_registration):
    for i in range(3):
        response = await auth_client.post(
            "/api/auth/register",
            json={
                "email": f"user{i}@example.com",
                "password": "hunter22",
                "firstName": "A",
                "lastName": "B",
            },
        )
        assert response.status_code == 200

    blocked = await auth_client.post(
        "/api/auth/register",
        json={"email": "user-extra@example.com", "password": "hunter22", "firstName": "A", "lastName": "B"},
    )
    assert blocked.status_code == 429
    assert "Retry-After" in blocked.headers
