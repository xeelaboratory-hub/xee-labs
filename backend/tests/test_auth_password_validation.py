import httpx
import pytest
from fastapi import FastAPI

from app.auth.rate_limit import ACCOUNT_LOGIN_LIMITER, LOGIN_LIMITER, REGISTER_LIMITER
from app.auth.router import router
from app.db.session import get_db
from app.validation import install_validation_error_redaction
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
    install_validation_error_redaction(app)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client

    await engine.dispose()


async def test_register_rejects_a_password_shorter_than_8_chars(auth_client):
    response = await auth_client.post(
        "/api/auth/register",
        json={"email": "a@example.com", "password": "short1", "firstName": "A", "lastName": "B"},
    )
    assert response.status_code == 422


async def test_register_accepts_an_8_char_password(auth_client):
    response = await auth_client.post(
        "/api/auth/register",
        json={"email": "a@example.com", "password": "exactly8", "firstName": "A", "lastName": "B"},
    )
    assert response.status_code == 200


async def test_register_password_validation_error_never_echoes_the_password(auth_client):
    response = await auth_client.post(
        "/api/auth/register",
        json={"email": "a@example.com", "password": "sup3r-s3cr3t-guess", "firstName": "A", "lastName": "B"},
    )
    # Long enough to pass length, but this asserts the general shape: even
    # a rejected password must never appear back in the response body.
    body = response.text
    assert "sup3r-s3cr3t-guess" not in body

    too_short = await auth_client.post(
        "/api/auth/register",
        json={"email": "b@example.com", "password": "nope42", "firstName": "A", "lastName": "B"},
    )
    assert too_short.status_code == 422
    detail = too_short.json()["detail"]
    assert len(detail) == 1
    assert "input" not in detail[0]
    assert "ctx" not in detail[0]
    assert "nope42" not in too_short.text


async def test_validation_redaction_does_not_hide_non_sensitive_fields(auth_client):
    # Missing/invalid non-sensitive fields should still report normally —
    # the redaction is targeted at credential-shaped fields only.
    response = await auth_client.post(
        "/api/auth/register",
        json={"email": "not-an-email", "password": "exactly8", "firstName": "A", "lastName": "B"},
    )
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert len(detail) == 1
    assert detail[0]["input"] == "not-an-email"


async def test_login_password_field_has_no_length_constraint(auth_client):
    # Login checks a password against a stored hash at runtime (auth
    # failure -> 401), not a pydantic length rule — a length-based 422 here
    # would incorrectly reject a legitimately short pre-existing password.
    response = await auth_client.post(
        "/api/auth/login", json={"email": "nobody@example.com", "password": "x"}
    )
    assert response.status_code == 401
