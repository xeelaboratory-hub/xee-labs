import pytest
from fastapi.testclient import TestClient

from app.auth.deps import get_current_user
from app.exchange.errors import ExchangeError
from app.main import app


class _FakeUser:
    id = "u1"
    status = "active"


class _FakeOKXClient:
    def __init__(
        self,
        balance=None,
        positions=None,
        orders=None,
        place_result=None,
        close_result=None,
        fills=None,
        raise_on=None,
    ):
        self._balance = balance or []
        self._positions = positions or []
        self._orders = orders or []
        self._place_result = place_result or [{"ordId": "123", "sCode": "0"}]
        self._close_result = close_result if close_result is not None else [{"instId": "BTC-USDT-SWAP"}]
        self._fills = fills or []
        self._raise_on = raise_on or set()

    async def get_balance(self):
        if "balance" in self._raise_on:
            raise ExchangeError("boom", code="1")
        return self._balance

    async def get_positions(self, inst_type="SWAP"):
        return self._positions

    async def get_open_orders(self, inst_type="SWAP"):
        return self._orders

    async def place_order(self, **kwargs):
        return self._place_result

    async def cancel_order(self, **kwargs):
        return [{"sCode": "0"}]

    async def close_position(self, **kwargs):
        return self._close_result

    async def place_reduce_only_order(self, **kwargs):
        return [{"sCode": "0"}]

    async def get_fills_history(self, inst_type="SWAP"):
        return self._fills


@pytest.fixture
def client(monkeypatch):
    app.dependency_overrides[get_current_user] = lambda: _FakeUser()
    yield TestClient(app)
    app.dependency_overrides.clear()


def _patch_client(monkeypatch, fake):
    async def fake_get_client(mode, user, db):
        return fake

    monkeypatch.setattr("app.api.trading._get_okx_client", fake_get_client)


def test_account_requires_auth():
    app.dependency_overrides.clear()
    res = TestClient(app).get("/api/account", params={"mode": "demo"})
    assert res.status_code == 401


def test_get_account_maps_balance(client, monkeypatch):
    _patch_client(monkeypatch, _FakeOKXClient(balance=[{"totalEq": "1000.5", "imr": "100"}]))
    res = client.get("/api/account", params={"mode": "demo"})
    assert res.status_code == 200
    body = res.json()
    assert body["balance"] == 1000.5
    assert body["margin"] == 100.0
    assert body["freeMargin"] == 900.5


def test_get_account_exchange_error_surfaces_as_502(client, monkeypatch):
    _patch_client(monkeypatch, _FakeOKXClient(raise_on={"balance"}))
    res = client.get("/api/account", params={"mode": "demo"})
    assert res.status_code == 502


def test_get_positions_filters_flat_positions(client, monkeypatch):
    _patch_client(
        monkeypatch,
        _FakeOKXClient(
            positions=[
                {"instId": "BTC-USDT-SWAP", "posSide": "long", "pos": "1.5", "avgPx": "50000", "upl": "10"},
                {"instId": "ETH-USDT-SWAP", "posSide": "long", "pos": "0", "avgPx": "0", "upl": "0"},
            ]
        ),
    )
    res = client.get("/api/positions", params={"mode": "demo"})
    assert res.status_code == 200
    body = res.json()
    assert len(body) == 1
    assert body[0]["symbolName"] == "OKX:BTCUSD"
    assert body[0]["side"] == "LONG"
    assert body[0]["quantity"] == 1.5


def test_get_orders_maps_status(client, monkeypatch):
    _patch_client(
        monkeypatch,
        _FakeOKXClient(
            orders=[
                {
                    "ordId": "1",
                    "instId": "BTC-USDT-SWAP",
                    "side": "buy",
                    "ordType": "limit",
                    "sz": "1",
                    "px": "50000",
                    "state": "live",
                    "fillSz": "0",
                }
            ]
        ),
    )
    res = client.get("/api/orders", params={"mode": "demo"})
    assert res.status_code == 200
    body = res.json()
    assert body[0]["status"] == "OPEN"
    assert body[0]["side"] == "BUY"
    assert body[0]["type"] == "LIMIT"


def test_place_order_success(client, monkeypatch):
    _patch_client(monkeypatch, _FakeOKXClient())
    res = client.post(
        "/api/orders",
        params={"mode": "demo"},
        json={"symbol": "OKX:BTCUSD", "side": "BUY", "type": "MARKET", "quantity": 1},
    )
    assert res.status_code == 201
    assert res.json() == {"orderId": "123"}


def test_place_order_rejected_by_exchange_surfaces_502(client, monkeypatch):
    _patch_client(
        monkeypatch,
        _FakeOKXClient(place_result=[{"sCode": "51000", "sMsg": "insufficient balance"}]),
    )
    res = client.post(
        "/api/orders",
        params={"mode": "demo"},
        json={"symbol": "OKX:BTCUSD", "side": "BUY", "type": "MARKET", "quantity": 1},
    )
    assert res.status_code == 502
    assert "insufficient balance" in res.json()["detail"]


def test_close_position_full(client, monkeypatch):
    _patch_client(monkeypatch, _FakeOKXClient())
    res = client.post(
        "/api/positions/close",
        params={"mode": "demo"},
        json={"symbol": "OKX:BTCUSD", "posSide": "long", "side": "LONG"},
    )
    assert res.status_code == 200
    assert res.json() == {"success": True}


def test_close_position_partial_uses_reduce_only_order(client, monkeypatch):
    _patch_client(monkeypatch, _FakeOKXClient())
    res = client.post(
        "/api/positions/close",
        params={"mode": "demo"},
        json={"symbol": "OKX:BTCUSD", "posSide": "long", "side": "LONG", "quantity": 0.5},
    )
    assert res.status_code == 200
    assert res.json() == {"success": True}


def test_close_position_exchange_rejection_surfaces_502(client, monkeypatch):
    _patch_client(monkeypatch, _FakeOKXClient(close_result=[{"sCode": "51000", "sMsg": "no position"}]))
    res = client.post(
        "/api/positions/close",
        params={"mode": "demo"},
        json={"symbol": "OKX:BTCUSD", "posSide": "long", "side": "LONG"},
    )
    assert res.status_code == 502
    assert "no position" in res.json()["detail"]


def test_trade_history_maps_fills(client, monkeypatch):
    _patch_client(
        monkeypatch,
        _FakeOKXClient(
            fills=[
                {
                    "tradeId": "t1",
                    "instId": "BTC-USDT-SWAP",
                    "side": "sell",
                    "fillSz": "1",
                    "fillPx": "51000",
                    "fee": "-2.5",
                    "pnl": "100",
                    "ts": "1700000000000",
                }
            ]
        ),
    )
    res = client.get("/api/trades/history", params={"mode": "demo"})
    assert res.status_code == 200
    body = res.json()
    assert body[0]["id"] == "t1"
    assert body[0]["side"] == "SELL"
    assert body[0]["fee"] == 2.5
    assert body[0]["realizedPnl"] == 100.0


def test_place_order_rejects_unknown_symbol(client, monkeypatch):
    _patch_client(monkeypatch, _FakeOKXClient())
    res = client.post(
        "/api/orders",
        params={"mode": "demo"},
        json={"symbol": "NOPE:XXXUSD", "side": "BUY", "type": "MARKET", "quantity": 1},
    )
    assert res.status_code == 400


def test_place_order_rejects_non_okx_symbol(client, monkeypatch):
    _patch_client(monkeypatch, _FakeOKXClient())
    res = client.post(
        "/api/orders",
        params={"mode": "demo"},
        json={"symbol": "BINANCE:BTCUSD", "side": "BUY", "type": "MARKET", "quantity": 1},
    )
    assert res.status_code == 400


def test_missing_credentials_returns_404(client, monkeypatch):
    async def fake_get_client(mode, user, db):
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail=f"no OKX {mode} credentials configured for this account")

    monkeypatch.setattr("app.api.trading._get_okx_client", fake_get_client)
    res = client.get("/api/account", params={"mode": "live"})
    assert res.status_code == 404
