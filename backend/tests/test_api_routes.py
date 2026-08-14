"""REST route contracts the frontend facade depends on directly — symbol
identity (name == id, all 15 SymbolSchema fields present) and the
single-symbol ticks route. Mounts market_data_router on a bare FastAPI app
(no lifespan) so these run without opening real exchange connections.
"""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.market_data import router
from app.schemas import Tick
from app.store import store

app = FastAPI()
app.include_router(router)
client = TestClient(app)


def test_symbols_have_name_equal_to_id_and_all_trading_fields():
    response = client.get("/api/market-data/symbols")
    assert response.status_code == 200
    symbols = response.json()
    assert len(symbols) == 4
    ids = {s["id"] for s in symbols}
    assert ids == {"BINANCE:BTCUSD", "BINANCE:ETHUSD", "OKX:BTCUSD", "OKX:ETHUSD"}
    for s in symbols:
        assert s["name"] == s["id"]
        for field in (
            "contractSize", "tickSize", "tickValue", "marginPercent", "maxLeverage",
            "commission", "swapLong", "swapShort", "tradingHoursStart", "tradingHoursEnd",
        ):
            assert field in s


def test_tick_route_404_for_unknown_symbol():
    response = client.get("/api/market-data/ticks/NOPE:BTCUSD")
    assert response.status_code == 404


def test_tick_route_404_when_no_tick_yet():
    response = client.get("/api/market-data/ticks/OKX:ETHUSD")
    assert response.status_code == 404


def test_tick_route_returns_stored_tick():
    store.set_tick(Tick(symbol="BINANCE:BTCUSD", exchange="binance", bid=100.0, ask=100.5, occurredAt=1700000000000))
    try:
        response = client.get("/api/market-data/ticks/BINANCE:BTCUSD")
        assert response.status_code == 200
        body = response.json()
        assert body["symbol"] == "BINANCE:BTCUSD"
        assert body["bid"] == 100.0
    finally:
        store._ticks.pop("BINANCE:BTCUSD", None)
