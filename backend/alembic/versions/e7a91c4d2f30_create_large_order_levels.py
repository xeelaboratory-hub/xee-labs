"""create large_order_levels

Revision ID: e7a91c4d2f30
Revises: b4d8e12f6a90
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "e7a91c4d2f30"
down_revision: Union[str, Sequence[str], None] = "b4d8e12f6a90"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "large_order_levels",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("symbol", sa.String(), nullable=False),
        sa.Column("side", sa.String(), nullable=False),
        sa.Column("price", sa.Numeric(), nullable=False),
        sa.Column("quantity", sa.Numeric(), nullable=False),
        sa.Column("current_notional", sa.Numeric(), nullable=False),
        sa.Column("peak_notional", sa.Numeric(), nullable=False),
        sa.Column("first_seen", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_large_order_levels_active",
        "large_order_levels",
        ["source", "symbol", "side", "price"],
        unique=True,
        postgresql_where=sa.text("ended_at IS NULL"),
    )
    op.create_index(
        "ix_large_order_levels_history",
        "large_order_levels",
        ["symbol", "first_seen", "ended_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_large_order_levels_history", table_name="large_order_levels")
    op.drop_index("uq_large_order_levels_active", table_name="large_order_levels")
    op.drop_table("large_order_levels")
