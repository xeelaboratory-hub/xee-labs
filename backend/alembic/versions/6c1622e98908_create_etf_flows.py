"""create etf_flows

Revision ID: 6c1622e98908
Revises: 9c8a60c78fca
Create Date: 2026-08-16 04:47:09.912110

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6c1622e98908'
down_revision: Union[str, Sequence[str], None] = '9c8a60c78fca'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('etf_flows',
    sa.Column('flow_date', sa.Date(), nullable=False),
    sa.Column('total_net_flow', sa.Numeric(), nullable=False),
    sa.Column('observed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('flow_date')
    )

    # NOTIFY bridge for the ETF Flow live-update path (Farside scraper -> Postgres
    # NOTIFY -> FastAPI LISTEN -> EventBus -> /ws). Two triggers, not one:
    #
    # - INSERT: notifies as changeType="new", but ONLY when observed_at IS NOT
    #   NULL. Historical backfill rows are always inserted with observed_at NULL
    #   (see scraper/app/upsert.py) and must never broadcast a WS event -- the
    #   frontend's initial state for historical data comes from REST alone.
    # - UPDATE: notifies as changeType="revision", but only on a genuine
    #   total_net_flow change (IS DISTINCT FROM guards against a no-op update
    #   firing a spurious NOTIFY). Not gated on observed_at -- a real revision
    #   to any existing row, including an originally-backfilled one, still
    #   notifies, since the frontend may already have that flowDate cached via
    #   REST and needs the correction pushed live.
    #
    # Postgres defers NOTIFY delivery until COMMIT automatically, so no extra
    # "notify after commit" handling is needed here.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION etf_flows_notify_insert() RETURNS trigger AS $$
        BEGIN
            IF NEW.observed_at IS NOT NULL THEN
                PERFORM pg_notify(
                    'etf_flow_changed',
                    json_build_object(
                        'changeType', 'new',
                        'flowDate', NEW.flow_date,
                        'totalNetFlow', NEW.total_net_flow,
                        'observedAt', NEW.observed_at,
                        'updatedAt', NEW.updated_at
                    )::text
                );
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION etf_flows_notify_update() RETURNS trigger AS $$
        BEGIN
            IF OLD.total_net_flow IS DISTINCT FROM NEW.total_net_flow THEN
                PERFORM pg_notify(
                    'etf_flow_changed',
                    json_build_object(
                        'changeType', 'revision',
                        'flowDate', NEW.flow_date,
                        'totalNetFlow', NEW.total_net_flow,
                        'observedAt', NEW.observed_at,
                        'updatedAt', NEW.updated_at
                    )::text
                );
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER etf_flows_after_insert
        AFTER INSERT ON etf_flows
        FOR EACH ROW EXECUTE FUNCTION etf_flows_notify_insert();
        """
    )
    op.execute(
        """
        CREATE TRIGGER etf_flows_after_update
        AFTER UPDATE ON etf_flows
        FOR EACH ROW EXECUTE FUNCTION etf_flows_notify_update();
        """
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP TRIGGER IF EXISTS etf_flows_after_update ON etf_flows")
    op.execute("DROP TRIGGER IF EXISTS etf_flows_after_insert ON etf_flows")
    op.execute("DROP FUNCTION IF EXISTS etf_flows_notify_update()")
    op.execute("DROP FUNCTION IF EXISTS etf_flows_notify_insert()")
    op.drop_table('etf_flows')
