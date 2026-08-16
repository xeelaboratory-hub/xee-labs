import base64
import hashlib
import hmac

from app.exchange.okx_client import OKXClient


def test_sign_matches_okx_spec():
    client = OKXClient(api_key="k", api_secret="secret", passphrase="p", is_demo=True)
    timestamp = "2020-12-08T09:08:57.715Z"
    method = "GET"
    request_path = "/api/v5/account/balance"
    body = ""

    expected = base64.b64encode(
        hmac.new(b"secret", f"{timestamp}{method}{request_path}{body}".encode(), hashlib.sha256).digest()
    ).decode()

    assert client._sign(timestamp, method, request_path, body) == expected


def test_demo_client_carries_is_demo_flag():
    assert OKXClient("k", "s", "p", is_demo=True)._is_demo is True
    assert OKXClient("k", "s", "p", is_demo=False)._is_demo is False
