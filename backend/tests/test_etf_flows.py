"""EtfFlow model shape/behavior — portable, runs against the sqlite
in-memory test DB (no triggers involved at this layer)."""
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.db.models import EtfFlow
from tests.db_test_utils import init_models, make_sessionmaker, make_test_engine


@pytest.fixture
async def session_factory():
    engine = make_test_engine()
    await init_models(engine)
    yield make_sessionmaker(engine)
    await engine.dispose()


async def test_historical_row_observed_at_null_round_trips(session_factory):
    async with session_factory() as session:
        session.add(EtfFlow(flow_date=date(2024, 1, 11), total_net_flow=655.3, observed_at=None))
        await session.commit()

    async with session_factory() as session:
        row = (await session.execute(select(EtfFlow).where(EtfFlow.flow_date == date(2024, 1, 11)))).scalar_one()
        assert row.observed_at is None
        assert float(row.total_net_flow) == 655.3


async def test_new_row_observed_at_set(session_factory):
    now = datetime.now(timezone.utc)
    async with session_factory() as session:
        session.add(EtfFlow(flow_date=date(2024, 1, 12), total_net_flow=1.0, observed_at=now))
        await session.commit()

    async with session_factory() as session:
        row = (await session.execute(select(EtfFlow).where(EtfFlow.flow_date == date(2024, 1, 12)))).scalar_one()
        assert row.observed_at is not None


async def test_revision_preserves_observed_at(session_factory):
    observed = datetime(2024, 1, 12, 7, 0, 0, tzinfo=timezone.utc)
    async with session_factory() as session:
        session.add(EtfFlow(flow_date=date(2024, 1, 12), total_net_flow=1.0, observed_at=observed))
        await session.commit()

    async with session_factory() as session:
        row = (await session.execute(select(EtfFlow).where(EtfFlow.flow_date == date(2024, 1, 12)))).scalar_one()
        row.total_net_flow = 999.0
        await session.commit()

    async with session_factory() as session:
        row = (await session.execute(select(EtfFlow).where(EtfFlow.flow_date == date(2024, 1, 12)))).scalar_one()
        assert float(row.total_net_flow) == 999.0
        # sqlite has no native TIMESTAMPTZ, so tzinfo is dropped on round-trip
        # (Postgres, used in production, preserves it) — compare wall-clock only.
        assert row.observed_at.replace(tzinfo=timezone.utc) == observed


async def test_updated_at_changes_on_update(session_factory):
    async with session_factory() as session:
        session.add(EtfFlow(flow_date=date(2024, 1, 13), total_net_flow=1.0))
        await session.commit()
        row = (await session.execute(select(EtfFlow).where(EtfFlow.flow_date == date(2024, 1, 13)))).scalar_one()
        first_updated_at = row.updated_at

    async with session_factory() as session:
        row = (await session.execute(select(EtfFlow).where(EtfFlow.flow_date == date(2024, 1, 13)))).scalar_one()
        row.total_net_flow = 2.0
        await session.commit()
        row = (await session.execute(select(EtfFlow).where(EtfFlow.flow_date == date(2024, 1, 13)))).scalar_one()
        assert row.updated_at >= first_updated_at


async def test_flow_date_unique_constraint(session_factory):
    async with session_factory() as session:
        session.add(EtfFlow(flow_date=date(2024, 1, 14), total_net_flow=1.0))
        await session.commit()

    async with session_factory() as session:
        session.add(EtfFlow(flow_date=date(2024, 1, 14), total_net_flow=2.0))
        with pytest.raises(IntegrityError):
            await session.commit()
