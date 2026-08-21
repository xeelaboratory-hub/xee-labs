"""Tests for the client-supplied order id (OKX's `clOrdId`) and the recovery it
enables.

The property under test is not "the field is forwarded" but "a submission whose
outcome we never learned can be resolved without re-sending it." A client-side
timeout, a dropped connection, and a read timeout between us and OKX are the
same event from the caller's side: the order may or may not be live. Before
this, the only available answer was to try again — which is how one order
becomes two.
"""
import pytest
from fastapi.testclient import TestClient

from app.auth.deps import get_current_user
from app.exchange.errors import ExchangeError
from app.exchange.okx_client import OKXClient
from app.main import app


# ── The body OKX actually receives ─────────────────────────────────────────


class _RecordingClient(OKXClient):
    """A real OKXClient with only the transport replaced, so the body under
    test is the one the client actually builds."""

    def __init__(self, response=None):
        super().__init__(api_key="k", api_secret="s", passphrase="p", is_demo=True)
        self.body = None
        self.params = None
        self._response = response if response is not None else [{"ordId": "1", "sCode": "0"}]

    async def _request(self, method, path, *, params=None, body=None):
        self.method, self.path, self.body, self.params = method, path, body, params
        return self._response


@pytest.mark.asyncio
async def test_place_order_carries_the_client_id():
    client = _RecordingClient()
    await client.place_order(
        inst_id="BTC-USDT-SWAP", side="buy", ord_type="market", size="1", cl_ord_id="xl123abc"
    )
    assert client.body["clOrdId"] == "xl123abc"


@pytest.mark.asyncio
async def test_place_order_omits_the_key_when_no_id_is_given():
    """OKX assigns its own clOrdId when the field is absent; sending an empty
    string instead is a rejected order."""
    client = _RecordingClient()
    await client.place_order(inst_id="BTC-USDT-SWAP", side="buy", ord_type="market", size="1")
    assert "clOrdId" not in client.body


@pytest.mark.asyncio
async def test_reduce_only_close_carries_the_client_id():
    """A partial close is an ordinary order and doubles exactly as badly as an
    entry does."""
    client = _RecordingClient()
    await client.place_reduce_only_order(
        inst_id="BTC-USDT-SWAP", side="sell", size="1", cl_ord_id="xlclose1"
    )
    assert client.body["clOrdId"] == "xlclose1"
    assert client.body["reduceOnly"] is True


@pytest.mark.asyncio
async def test_full_close_carries_the_client_id():
    client = _RecordingClient(response=[{"instId": "BTC-USDT-SWAP"}])
    await client.close_position(inst_id="BTC-USDT-SWAP", pos_side="long", cl_ord_id="xlclose2")
    assert client.body["clOrdId"] == "xlclose2"


@pytest.mark.asyncio
async def test_lookup_asks_okx_by_client_id():
    client = _RecordingClient(response=[{"ordId": "999", "clOrdId": "xlabc"}])
    found = await client.get_order_by_client_id(inst_id="BTC-USDT-SWAP", cl_ord_id="xlabc")
    assert client.path == "/api/v5/trade/order"
    assert client.params == {"instId": "BTC-USDT-SWAP", "clOrdId": "xlabc"}
    assert found["ordId"] == "999"


@pytest.mark.asyncio
async def test_lookup_returns_none_when_okx_has_no_such_order():
    """51603 is OKX's "order does not exist" — a real answer, not a failure.
    Surfacing it as an error would leave the caller as unsure as before."""

    class _NotFound(_RecordingClient):
        async def _request(self, method, path, *, params=None, body=None):
            raise ExchangeError("Order does not exist", code="51603")

    assert await _NotFound().get_order_by_client_id(inst_id="BTC-USDT-SWAP", cl_ord_id="x") is None


@pytest.mark.asyncio
async def test_lookup_propagates_other_errors():
    """A rate-limited or unauthenticated lookup is not evidence of absence."""

    class _Broken(_RecordingClient):
        async def _request(self, method, path, *, params=None, body=None):
            raise ExchangeError("Too Many Requests", code="50011")

    with pytest.raises(ExchangeError):
        await _Broken().get_order_by_client_id(inst_id="BTC-USDT-SWAP", cl_ord_id="x")


# ── OKX's two-level error shape ────────────────────────────────────────────


class _StubResponse:
    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


@pytest.mark.asyncio
async def test_per_order_reason_beats_the_generic_top_level_message(monkeypatch):
    """OKX reports a rejected order twice: "1"/"Operation failed." at the top
    level, and the actual reason in data[0]. Keying on the top-level pair makes
    a duplicate id indistinguishable from any other rejection, and shows the
    user a message that names no cause."""

    class _FakeHTTPClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def request(self, *args, **kwargs):
            return _StubResponse(
                {
                    "code": "1",
                    "msg": "Operation failed.",
                    "data": [{"sCode": "51016", "sMsg": "Duplicated client order ID", "ordId": ""}],
                }
            )

    monkeypatch.setattr("app.exchange.okx_client.httpx.AsyncClient", lambda **kw: _FakeHTTPClient())
    client = OKXClient(api_key="k", api_secret="s", passphrase="p", is_demo=True)
    with pytest.raises(ExchangeError) as exc:
        await client.place_order(inst_id="BTC-USDT-SWAP", side="buy", ord_type="market", size="1")
    assert exc.value.code == "51016"
    assert "Duplicated client order ID" in str(exc.value)


# ── The API layer ──────────────────────────────────────────────────────────


class _FakeUser:
    id = "u1"
    status = "active"


class _FakeOKXClient:
    """Records what the route passed down, and lets each test decide how the
    submission fails and whether OKX has the order afterwards."""

    def __init__(self, *, place_raises=None, lookup_result=None, lookup_raises=None):
        self.place_kwargs = None
        self.close_kwargs = None
        self.lookup_kwargs = None
        self.lookup_calls = 0
        self._place_raises = place_raises
        self._lookup_result = lookup_result
        self._lookup_raises = lookup_raises

    async def place_order(self, **kwargs):
        self.place_kwargs = kwargs
        if self._place_raises:
            raise self._place_raises
        return [{"ordId": "123", "sCode": "0"}]

    async def close_position(self, **kwargs):
        self.close_kwargs = kwargs
        if self._place_raises:
            raise self._place_raises
        return [{"instId": "BTC-USDT-SWAP"}]

    async def place_reduce_only_order(self, **kwargs):
        self.close_kwargs = kwargs
        if self._place_raises:
            raise self._place_raises
        return [{"sCode": "0"}]

    async def get_order_by_client_id(self, **kwargs):
        self.lookup_kwargs = kwargs
        self.lookup_calls += 1
        if self._lookup_raises:
            raise self._lookup_raises
        return self._lookup_result


@pytest.fixture
def client():
    app.dependency_overrides[get_current_user] = lambda: _FakeUser()
    yield TestClient(app)
    app.dependency_overrides.clear()


def _patch_client(monkeypatch, fake):
    async def fake_get_client(mode, user, db):
        return fake

    monkeypatch.setattr("app.api.trading._get_okx_client", fake_get_client)


_ORDER = {"symbol": "OKX:BTCUSD", "side": "BUY", "type": "MARKET", "quantity": 1}
_FILLED = {
    "ordId": "777",
    "instId": "BTC-USDT-SWAP",
    "side": "buy",
    "ordType": "market",
    "sz": "1",
    "px": "50000",
    "state": "filled",
    "cTime": "1700000000000",
}


def test_client_order_id_reaches_okx(client, monkeypatch):
    fake = _FakeOKXClient()
    _patch_client(monkeypatch, fake)
    res = client.post("/api/orders", params={"mode": "demo"}, json={**_ORDER, "clientOrderId": "xlabc123"})
    assert res.status_code == 201
    assert fake.place_kwargs["cl_ord_id"] == "xlabc123"


def test_order_without_a_client_id_still_places(client, monkeypatch):
    """The field is optional: an older client, or any caller that doesn't want
    recovery, must keep working."""
    fake = _FakeOKXClient()
    _patch_client(monkeypatch, fake)
    res = client.post("/api/orders", params={"mode": "demo"}, json=_ORDER)
    assert res.status_code == 201
    assert fake.place_kwargs["cl_ord_id"] is None


@pytest.mark.parametrize("bad", ["has-a-dash", "has space", "a" * 33, ""])
def test_malformed_client_order_id_is_rejected(client, monkeypatch, bad):
    """OKX takes alphanumerics up to 32 characters. Rejecting here means the
    caller learns its key was never usable, instead of discovering it from a
    rejected order."""
    _patch_client(monkeypatch, _FakeOKXClient())
    res = client.post("/api/orders", params={"mode": "demo"}, json={**_ORDER, "clientOrderId": bad})
    assert res.status_code == 422


def test_duplicate_client_id_reports_the_order_that_already_exists(client, monkeypatch):
    """OKX rejecting a duplicate id means the first submission worked. Passing
    that back as a 502 would tell the user their order failed while it is live."""
    fake = _FakeOKXClient(
        place_raises=ExchangeError("Duplicated client order ID", code="51016"),
        lookup_result={"ordId": "777"},
    )
    _patch_client(monkeypatch, fake)
    res = client.post("/api/orders", params={"mode": "demo"}, json={**_ORDER, "clientOrderId": "xlabc123"})
    assert res.status_code == 201
    assert res.json() == {"orderId": "777", "duplicate": True}


def test_transport_failure_reports_the_order_that_landed_anyway(client, monkeypatch):
    """`ExchangeError` with no code is httpx never getting a reply — the
    request may well have completed at OKX. Asking is the only way to know."""
    fake = _FakeOKXClient(
        place_raises=ExchangeError("OKX request failed: ReadTimeout"),
        lookup_result={"ordId": "888"},
    )
    _patch_client(monkeypatch, fake)
    res = client.post("/api/orders", params={"mode": "demo"}, json={**_ORDER, "clientOrderId": "xlabc123"})
    assert res.status_code == 201
    assert res.json() == {"orderId": "888", "duplicate": True}


def test_transport_failure_with_no_order_at_okx_still_fails(client, monkeypatch):
    """Nothing landed — the caller must see the failure, not a fabricated id."""
    fake = _FakeOKXClient(
        place_raises=ExchangeError("OKX request failed: ReadTimeout"), lookup_result=None
    )
    _patch_client(monkeypatch, fake)
    res = client.post("/api/orders", params={"mode": "demo"}, json={**_ORDER, "clientOrderId": "xlabc123"})
    assert res.status_code == 502
    assert fake.lookup_calls == 1


def test_a_named_rejection_is_not_looked_up(client, monkeypatch):
    """OKX naming a reason — insufficient margin here — is definitive: no order
    exists. A lookup would only add latency to an answer already given."""
    fake = _FakeOKXClient(place_raises=ExchangeError("Insufficient balance", code="51008"))
    _patch_client(monkeypatch, fake)
    res = client.post("/api/orders", params={"mode": "demo"}, json={**_ORDER, "clientOrderId": "xlabc123"})
    assert res.status_code == 502
    assert "Insufficient balance" in res.json()["detail"]
    assert fake.lookup_calls == 0


def test_recovery_needs_a_client_id(client, monkeypatch):
    """Without an id there is nothing to ask about, so the failure stands."""
    fake = _FakeOKXClient(place_raises=ExchangeError("OKX request failed: ReadTimeout"))
    _patch_client(monkeypatch, fake)
    res = client.post("/api/orders", params={"mode": "demo"}, json=_ORDER)
    assert res.status_code == 502
    assert fake.lookup_calls == 0


def test_a_failed_lookup_leaves_the_original_error_standing(client, monkeypatch):
    """When the lookup itself can't reach OKX, the honest answer is the error
    the caller already had — not a guess in either direction."""
    fake = _FakeOKXClient(
        place_raises=ExchangeError("OKX request failed: ReadTimeout"),
        lookup_raises=ExchangeError("OKX request failed: ReadTimeout"),
    )
    _patch_client(monkeypatch, fake)
    res = client.post("/api/orders", params={"mode": "demo"}, json={**_ORDER, "clientOrderId": "xlabc123"})
    assert res.status_code == 502


# ── Closing a position ─────────────────────────────────────────────────────

_CLOSE = {"symbol": "OKX:BTCUSD", "posSide": "long", "side": "LONG"}


def test_full_close_forwards_the_client_id(client, monkeypatch):
    fake = _FakeOKXClient()
    _patch_client(monkeypatch, fake)
    res = client.post(
        "/api/positions/close", params={"mode": "demo"}, json={**_CLOSE, "clientOrderId": "xlclose1"}
    )
    assert res.status_code == 200
    assert fake.close_kwargs["cl_ord_id"] == "xlclose1"


def test_partial_close_forwards_the_client_id(client, monkeypatch):
    fake = _FakeOKXClient()
    _patch_client(monkeypatch, fake)
    res = client.post(
        "/api/positions/close",
        params={"mode": "demo"},
        json={**_CLOSE, "quantity": 0.5, "clientOrderId": "xlclose2"},
    )
    assert res.status_code == 200
    assert fake.close_kwargs["cl_ord_id"] == "xlclose2"


def test_interrupted_close_that_landed_reports_success(client, monkeypatch):
    fake = _FakeOKXClient(
        place_raises=ExchangeError("OKX request failed: ReadTimeout"),
        lookup_result={"ordId": "999"},
    )
    _patch_client(monkeypatch, fake)
    res = client.post(
        "/api/positions/close",
        params={"mode": "demo"},
        json={**_CLOSE, "quantity": 0.5, "clientOrderId": "xlclose2"},
    )
    assert res.status_code == 200
    assert res.json() == {"success": True, "duplicate": True}


def test_interrupted_close_that_did_not_land_still_fails(client, monkeypatch):
    fake = _FakeOKXClient(
        place_raises=ExchangeError("OKX request failed: ReadTimeout"), lookup_result=None
    )
    _patch_client(monkeypatch, fake)
    res = client.post(
        "/api/positions/close",
        params={"mode": "demo"},
        json={**_CLOSE, "quantity": 0.5, "clientOrderId": "xlclose2"},
    )
    assert res.status_code == 502


# ── The lookup route ───────────────────────────────────────────────────────


def test_lookup_route_returns_the_mapped_order(client, monkeypatch):
    fake = _FakeOKXClient(lookup_result=_FILLED)
    _patch_client(monkeypatch, fake)
    res = client.get(
        "/api/orders/by-client-id",
        params={"mode": "demo", "symbol": "OKX:BTCUSD", "clientOrderId": "xlabc123"},
    )
    assert res.status_code == 200
    assert res.json()["id"] == "777"
    assert fake.lookup_kwargs == {"inst_id": "BTC-USDT-SWAP", "cl_ord_id": "xlabc123"}


def test_lookup_route_404s_when_nothing_was_placed(client, monkeypatch):
    """A 404 here is the answer that makes retrying safe, so it has to be
    distinguishable from the failure modes that don't."""
    _patch_client(monkeypatch, _FakeOKXClient(lookup_result=None))
    res = client.get(
        "/api/orders/by-client-id",
        params={"mode": "demo", "symbol": "OKX:BTCUSD", "clientOrderId": "xlabc123"},
    )
    assert res.status_code == 404


def test_lookup_route_502s_when_okx_cannot_be_reached(client, monkeypatch):
    """Not a 404: "we couldn't ask" must never read as "nothing was placed"."""
    _patch_client(monkeypatch, _FakeOKXClient(lookup_raises=ExchangeError("boom", code="50011")))
    res = client.get(
        "/api/orders/by-client-id",
        params={"mode": "demo", "symbol": "OKX:BTCUSD", "clientOrderId": "xlabc123"},
    )
    assert res.status_code == 502


def test_lookup_route_rejects_a_malformed_id(client, monkeypatch):
    _patch_client(monkeypatch, _FakeOKXClient(lookup_result=_FILLED))
    res = client.get(
        "/api/orders/by-client-id",
        params={"mode": "demo", "symbol": "OKX:BTCUSD", "clientOrderId": "not valid"},
    )
    assert res.status_code == 422


def test_lookup_route_requires_auth():
    app.dependency_overrides.clear()
    res = TestClient(app).get(
        "/api/orders/by-client-id",
        params={"mode": "demo", "symbol": "OKX:BTCUSD", "clientOrderId": "xlabc123"},
    )
    assert res.status_code == 401
