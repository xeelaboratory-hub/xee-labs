"""GET /api/market-data/instrument/{symbol} — Position Builder's real-spec
fetch. Covers the contract PositionBuilderPanel depends on: OKX symbols
return real specs, non-OKX symbols are rejected, unknown symbols 404, and
an empty OKX response maps to a clean 502 rather than an unhandled error.
"""
from fastapi.testclient import TestClient

from app.exchange import okx_instruments
from app.main import app

OKX_BTC_RAW = {
    "instId": "BTC-USDT-SWAP",
    "instType": "SWAP",
    "ctVal": "0.01",
    "ctValCcy": "BTC",
    "lotSz": "1",
    "minSz": "1",
    "tickSz": "0.1",
    "settleCcy": "USDT",
    "quoteCcy": "USDT",
    "baseCcy": "BTC",
    "lever": "100",
}


def test_okx_symbol_returns_mapped_instrument_spec(monkeypatch):
    async def fake_fetch(inst_id, inst_type):
        assert inst_id == "BTC-USDT-SWAP"
        assert inst_type == "SWAP"
        return OKX_BTC_RAW

    monkeypatch.setattr(okx_instruments, "fetch_instrument", fake_fetch)
    okx_instruments._cache.clear()

    res = TestClient(app).get("/api/market-data/instrument/OKX:BTCUSD")

    assert res.status_code == 200
    body = res.json()
    assert body["instId"] == "BTC-USDT-SWAP"
    assert body["ctVal"] == 0.01
    assert body["lotSz"] == 1.0
    assert body["minSz"] == 1.0
    assert body["tickSz"] == 0.1
    assert body["maxLever"] == 100.0


def test_non_okx_symbol_returns_400():
    res = TestClient(app).get("/api/market-data/instrument/BINANCE:BTCUSD")

    assert res.status_code == 400


def test_unknown_symbol_returns_404():
    res = TestClient(app).get("/api/market-data/instrument/OKX:NOPE")

    assert res.status_code == 404


def test_empty_okx_response_returns_502(monkeypatch):
    async def fake_fetch(inst_id, inst_type):
        return None

    monkeypatch.setattr(okx_instruments, "fetch_instrument", fake_fetch)
    okx_instruments._cache.clear()

    res = TestClient(app).get("/api/market-data/instrument/OKX:BTCUSD")

    assert res.status_code == 502


def test_second_call_within_ttl_hits_cache_not_fetch(monkeypatch):
    call_count = 0

    async def fake_fetch(inst_id, inst_type):
        nonlocal call_count
        call_count += 1
        return OKX_BTC_RAW

    monkeypatch.setattr(okx_instruments, "fetch_instrument", fake_fetch)
    okx_instruments._cache.clear()

    client = TestClient(app)
    first = client.get("/api/market-data/instrument/OKX:BTCUSD")
    second = client.get("/api/market-data/instrument/OKX:BTCUSD")

    assert first.status_code == 200
    assert second.status_code == 200
    assert call_count == 1
