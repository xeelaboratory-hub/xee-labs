"""In-memory L2 lifecycle tracking with best-effort PostgreSQL history."""
import asyncio
import logging
import uuid
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import delete, select, update

from app.bus import bus
from app.db.models import LargeOrderLevel as LargeOrderLevelModel
from app.db.session import SessionLocal
from app.schemas import LargeOrderBookUpdatedEvent, LargeOrderLevel
from app.symbols import SymbolInfo

LOG = logging.getLogger("large_order_book")
CAPTURE_NOTIONAL = Decimal("500000")
RETENTION_DAYS = 30
PUBLISH_INTERVAL_SECONDS = 0.5


@dataclass
class _Level:
    id: uuid.UUID
    source: str
    symbol: str
    side: str
    price: Decimal
    quantity: Decimal
    current_notional: Decimal
    peak_notional: Decimal
    first_seen: datetime
    last_seen: datetime
    ended_at: datetime | None = None
    captured: bool = False

    def schema(self) -> LargeOrderLevel:
        return LargeOrderLevel(
            id=str(self.id),
            source=self.source,
            symbol=self.symbol,
            side=self.side,
            price=float(self.price),
            quantity=float(self.quantity),
            currentNotional=float(self.current_notional),
            peakNotional=float(self.peak_notional),
            firstSeen=self.first_seen,
            lastSeen=self.last_seen,
            endedAt=self.ended_at,
        )


class LargeOrderBookService:
    def __init__(self) -> None:
        self._levels: dict[tuple[str, str, str, Decimal], _Level] = {}
        self._dirty: dict[uuid.UUID, _Level] = {}
        self._latest: dict[tuple[str, str], LargeOrderBookUpdatedEvent] = {}
        self._last_publish: dict[tuple[str, str], float] = {}
        self._pending_publish: dict[tuple[str, str], datetime] = {}
        self._db_prepared = False
        self._last_cleanup: date | None = None

    def process_book(self, source: str, info: SymbolInfo, book: object, occurred_at: datetime) -> None:
        """Replace one exchange/symbol view; unchanged prices retain first_seen."""
        current: set[tuple[str, str, str, Decimal]] = set()
        multiplier = Decimal(str(info.book_size_multiplier))

        for side in ("bid", "ask"):
            for price_raw, size_raw in self._side_items(book, side):
                key = self._upsert(source, info, side, price_raw, size_raw, multiplier, occurred_at)
                if key is not None:
                    current.add(key)

        prefix = (source, info.id)
        for key, level in list(self._levels.items()):
            if key[:2] != prefix or key in current:
                continue
            self._end_level(key, occurred_at)

        self._publish(prefix, occurred_at)

    def process_delta(self, source: str, info: SymbolInfo, delta: object, occurred_at: datetime) -> None:
        """Apply only changed L2 prices; the initial snapshot seeds all levels."""
        multiplier = Decimal(str(info.book_size_multiplier))
        for side in ("bid", "ask"):
            for price_raw, size_raw in self._side_items(delta, side):
                price = Decimal(str(price_raw))
                key = (source, info.id, side, price)
                if Decimal(str(size_raw)) <= 0:
                    self._end_level(key, occurred_at)
                else:
                    self._upsert(source, info, side, price, size_raw, multiplier, occurred_at)
        self._queue_publish((source, info.id), occurred_at)

    def _upsert(
        self,
        source: str,
        info: SymbolInfo,
        side: str,
        price_raw: object,
        size_raw: object,
        multiplier: Decimal,
        occurred_at: datetime,
    ) -> tuple[str, str, str, Decimal] | None:
        price = Decimal(str(price_raw))
        quantity = Decimal(str(size_raw)) * multiplier
        if quantity <= 0:
            return None
        key = (source, info.id, side, price)
        notional = price * quantity
        level = self._levels.get(key)
        if level is None or level.ended_at is not None:
            level = _Level(
                id=uuid.uuid4(), source=source, symbol=info.id, side=side,
                price=price, quantity=quantity, current_notional=notional,
                peak_notional=notional, first_seen=occurred_at, last_seen=occurred_at,
            )
            self._levels[key] = level
        else:
            level.quantity = quantity
            level.current_notional = notional
            level.peak_notional = max(level.peak_notional, notional)
            level.last_seen = occurred_at
        if notional >= CAPTURE_NOTIONAL:
            level.captured = True
        if level.captured:
            self._dirty[level.id] = replace(level)
        return key

    def _end_level(self, key: tuple[str, str, str, Decimal], occurred_at: datetime) -> None:
        level = self._levels.get(key)
        if level is None or level.ended_at is not None:
            return
        level.ended_at = occurred_at
        level.last_seen = occurred_at
        level.current_notional = Decimal(0)
        if level.captured:
            self._dirty[level.id] = replace(level)
        else:
            del self._levels[key]

    def _publish(self, prefix: tuple[str, str], occurred_at: datetime) -> None:
        source, symbol = prefix
        active = [
            level.schema()
            for key, level in self._levels.items()
            if key[:2] == prefix and level.ended_at is None and level.current_notional >= CAPTURE_NOTIONAL
        ]
        previous = self._latest.get(prefix)
        previous_by_id = {level.id: level for level in previous.levels} if previous else {}
        active_by_id = {level.id: level for level in active}
        changed = [level for level in active if previous_by_id.get(level.id) != level]
        removed_ids = [level_id for level_id in previous_by_id if level_id not in active_by_id]
        sequence = (previous.sequence if previous else 0) + 1

        self._latest[prefix] = LargeOrderBookUpdatedEvent(
            mode="snapshot",
            sequence=sequence,
            symbol=symbol,
            source=source,
            levels=active,
            occurredAt=occurred_at,
        )
        self._last_publish[prefix] = asyncio.get_running_loop().time()
        self._pending_publish.pop(prefix, None)
        bus.publish(LargeOrderBookUpdatedEvent(
            mode="delta",
            sequence=sequence,
            symbol=symbol,
            source=source,
            levels=changed,
            removedIds=removed_ids,
            occurredAt=occurred_at,
        ))

    def _queue_publish(self, prefix: tuple[str, str], occurred_at: datetime) -> None:
        now = asyncio.get_running_loop().time()
        if now - self._last_publish.get(prefix, 0) >= PUBLISH_INTERVAL_SECONDS:
            self._publish(prefix, occurred_at)
        else:
            self._pending_publish[prefix] = occurred_at

    def _publish_pending_events(self) -> None:
        now = asyncio.get_running_loop().time()
        for prefix, occurred_at in list(self._pending_publish.items()):
            if now - self._last_publish.get(prefix, 0) >= PUBLISH_INTERVAL_SECONDS:
                self._publish(prefix, occurred_at)

    @staticmethod
    def _side_items(book: object, side: str):
        try:
            side_book = book[side]  # type: ignore[index]
            return side_book.items() if hasattr(side_book, "items") else side_book
        except (KeyError, TypeError):
            return ()

    def latest_events(self, symbols: set[str] | None = None) -> list[LargeOrderBookUpdatedEvent]:
        return [
            event
            for (_source, symbol), event in self._latest.items()
            if symbols is None or symbol in symbols
        ]

    async def run(self, stop_event: asyncio.Event) -> None:
        loop = asyncio.get_running_loop()
        next_flush = loop.time()
        while not stop_event.is_set():
            self._publish_pending_events()
            if loop.time() >= next_flush:
                await self._flush()
                next_flush = loop.time() + 2
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=0.2)
            except asyncio.TimeoutError:
                pass
        self._publish_pending_events()
        await self._flush()

    async def _flush(self) -> None:
        if not self._dirty and self._db_prepared:
            return
        try:
            async with SessionLocal() as session:
                if not self._db_prepared:
                    await session.execute(
                        update(LargeOrderLevelModel)
                        .where(LargeOrderLevelModel.ended_at.is_(None))
                        .values(ended_at=LargeOrderLevelModel.last_seen)
                    )
                    self._db_prepared = True
                pending = list(self._dirty.values())
                ended = [level for level in pending if level.ended_at is not None]
                active = [level for level in pending if level.ended_at is None]
                for level in ended:
                    await session.merge(
                        LargeOrderLevelModel(
                            id=level.id,
                            source=level.source,
                            symbol=level.symbol,
                            side=level.side,
                            price=level.price,
                            quantity=level.quantity,
                            current_notional=level.current_notional,
                            peak_notional=level.peak_notional,
                            first_seen=level.first_seen,
                            last_seen=level.last_seen,
                            ended_at=level.ended_at,
                        )
                    )
                await session.flush()
                for level in active:
                    # A price can disappear and reappear between two flushes.
                    # Close the prior DB lifecycle before inserting the new id.
                    await session.execute(
                        update(LargeOrderLevelModel)
                        .where(
                            LargeOrderLevelModel.source == level.source,
                            LargeOrderLevelModel.symbol == level.symbol,
                            LargeOrderLevelModel.side == level.side,
                            LargeOrderLevelModel.price == level.price,
                            LargeOrderLevelModel.ended_at.is_(None),
                            LargeOrderLevelModel.id != level.id,
                        )
                        .values(ended_at=level.first_seen, last_seen=level.first_seen)
                    )
                    await session.merge(
                        LargeOrderLevelModel(
                            id=level.id,
                            source=level.source,
                            symbol=level.symbol,
                            side=level.side,
                            price=level.price,
                            quantity=level.quantity,
                            current_notional=level.current_notional,
                            peak_notional=level.peak_notional,
                            first_seen=level.first_seen,
                            last_seen=level.last_seen,
                            ended_at=None,
                        )
                    )
                today = datetime.now(timezone.utc).date()
                if self._last_cleanup != today:
                    cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
                    await session.execute(
                        delete(LargeOrderLevelModel).where(LargeOrderLevelModel.ended_at < cutoff)
                    )
                await session.commit()
                self._last_cleanup = today
            for level in pending:
                if self._dirty.get(level.id) is level:
                    self._dirty.pop(level.id, None)
                key = (level.source, level.symbol, level.side, level.price)
                current = self._levels.get(key)
                if level.ended_at is not None and current is not None and current.id == level.id:
                    self._levels.pop(key, None)
        except Exception:
            self._db_prepared = False
            LOG.exception("large-order history unavailable; live tracking continues")


service = LargeOrderBookService()
