import json
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import FastAPI

from app.api.market_data import router
from app.bus import bus
from app.db.models import LargeOrderLevel as LargeOrderLevelModel
from app.db.session import get_db
from app.large_order_book import LargeOrderBookService
from app.symbols import get_symbol
from app.feeds.okx import OKX
from cryptofeed.defines import L2_BOOK
from tests.db_test_utils import init_models, make_sessionmaker, make_test_engine


async def test_price_level_age_survives_resize_and_resets_after_removal() -> None:
    service = LargeOrderBookService()
    symbol = get_symbol("BINANCE:BTCUSD")
    assert symbol is not None
    started = datetime(2026, 8, 17, tzinfo=timezone.utc)

    service.process_book("binance", symbol, {"bid": {50_000: 25}, "ask": {}}, started)
    first = service.latest_events()[0].levels[0]

    service.process_book(
        "binance", symbol, {"bid": {50_000: 30}, "ask": {}}, started + timedelta(seconds=5)
    )
    resized = service.latest_events()[0].levels[0]
    assert resized.id == first.id
    assert resized.firstSeen == started
    assert resized.peakNotional == 1_500_000

    service.process_book("binance", symbol, {"bid": {}, "ask": {}}, started + timedelta(seconds=10))
    assert service.latest_events()[0].levels == []

    service.process_book(
        "binance", symbol, {"bid": {50_000: 25}, "ask": {}}, started + timedelta(seconds=15)
    )
    reappeared = service.latest_events()[0].levels[0]
    assert reappeared.id != first.id
    assert reappeared.firstSeen == started + timedelta(seconds=15)


async def test_okx_contract_size_is_converted_to_base_quantity() -> None:
    service = LargeOrderBookService()
    symbol = get_symbol("OKX:BTCUSD")
    assert symbol is not None
    now = datetime.now(timezone.utc)

    service.process_book("okx", symbol, {"bid": {50_000: 2_000}, "ask": {}}, now)

    level = service.latest_events()[0].levels[0]
    assert level.quantity == 20
    assert level.currentNotional == 1_000_000


async def test_half_million_is_the_capture_floor() -> None:
    service = LargeOrderBookService()
    symbol = get_symbol("BINANCE:BTCUSD")
    assert symbol is not None

    service.process_book(
        "binance",
        symbol,
        {"bid": {50_000: 10, 49_000: 10}, "ask": {}},
        datetime.now(timezone.utc),
    )

    assert [level.price for level in service.latest_events()[0].levels] == [50_000]


async def test_delta_updates_only_changed_levels_and_preserves_lifecycle() -> None:
    service = LargeOrderBookService()
    symbol = get_symbol("BINANCE:BTCUSD")
    assert symbol is not None
    started = datetime(2026, 8, 17, tzinfo=timezone.utc)

    service.process_book(
        "binance", symbol, {"bid": {50_000: 25, 49_000: 1}, "ask": {}}, started
    )
    first = service.latest_events()[0].levels[0]
    service._last_publish.clear()
    service.process_delta(
        "binance", symbol, {"bid": [(50_000, 30)], "ask": []}, started + timedelta(seconds=1)
    )
    resized = service.latest_events()[0].levels[0]
    assert resized.id == first.id
    assert resized.firstSeen == started
    assert resized.currentNotional == 1_500_000

    service._last_publish.clear()
    service.process_delta(
        "binance", symbol, {"bid": [(50_000, 0)], "ask": []}, started + timedelta(seconds=2)
    )
    assert service.latest_events()[0].levels == []


async def test_ws_updates_send_only_changed_and_removed_levels() -> None:
    service = LargeOrderBookService()
    symbol = get_symbol("BINANCE:BTCUSD")
    assert symbol is not None
    started = datetime(2026, 8, 17, tzinfo=timezone.utc)
    queue = bus.subscribe()
    try:
        service.process_book("binance", symbol, {"bid": {50_000: 25}, "ask": {}}, started)
        created = queue.get_nowait()
        level_id = created.levels[0].id
        assert created.mode == "delta"
        assert created.sequence == 1
        assert created.removedIds == []

        service._last_publish.clear()
        service.process_delta(
            "binance", symbol, {"bid": [(49_000, 1)], "ask": []}, started + timedelta(milliseconds=500)
        )
        heartbeat = queue.get_nowait()
        assert heartbeat.sequence == 2
        assert heartbeat.levels == []
        assert heartbeat.removedIds == []

        service._last_publish.clear()
        service.process_delta(
            "binance", symbol, {"bid": [(50_000, 30)], "ask": []}, started + timedelta(seconds=1)
        )
        resized = queue.get_nowait()
        assert resized.sequence == 3
        assert [level.id for level in resized.levels] == [level_id]

        service._last_publish.clear()
        service.process_delta(
            "binance", symbol, {"bid": [(50_000, 1)], "ask": []}, started + timedelta(seconds=2)
        )
        removed = queue.get_nowait()
        assert removed.sequence == 4
        assert removed.levels == []
        assert removed.removedIds == [level_id]

        snapshot = service.latest_events()[0]
        assert snapshot.mode == "snapshot"
        assert snapshot.sequence == 4
        assert snapshot.levels == []
    finally:
        bus.unsubscribe(queue)


async def test_okx_subscribes_only_to_the_connections_filtered_channels() -> None:
    sent: list[str] = []

    class Connection:
        subscription = {"books": ["BTC-USDT-SWAP"]}

        async def write(self, message: str) -> None:
            sent.append(message)

    feed = OKX(symbols=["BTC-USDT-PERP"], channels=[L2_BOOK])
    await feed.subscribe(Connection())

    assert json.loads(sent[0]) == {
        "op": "subscribe",
        "args": [{"channel": "books", "instId": "BTC-USDT-SWAP"}],
    }


async def test_history_limit_returns_only_the_latest_levels() -> None:
    engine = make_test_engine()
    await init_models(engine)
    session_factory = make_sessionmaker(engine)
    started = datetime.now(timezone.utc) - timedelta(minutes=5)

    async with session_factory() as session:
        for index in range(3):
            seen = started + timedelta(minutes=index)
            session.add(LargeOrderLevelModel(
                source="binance", symbol="BINANCE:BTCUSD", side="bid",
                price=60_000 + index, quantity=20, current_notional=0,
                peak_notional=1_200_000, first_seen=seen, last_seen=seen,
                ended_at=seen + timedelta(seconds=10),
            ))
        await session.commit()

    async def override_get_db():
        async with session_factory() as session:
            yield session

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = override_get_db
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/api/market-data/large-order-book/history",
            params={"base": "BTC", "source": "binance", "threshold": 1_000_000, "limit": 2},
        )

    assert response.status_code == 200
    assert [row["price"] for row in response.json()] == [60_002, 60_001]
    await engine.dispose()
