import uuid
from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Index, LargeBinary, Numeric, String, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    first_name: Mapped[str] = mapped_column(String, nullable=False)
    last_name: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    exchange_credentials: Mapped[list["ExchangeCredential"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    preferences: Mapped["UserPreference | None"] = relationship(
        back_populates="user", cascade="all, delete-orphan", uselist=False
    )


class RefreshToken(Base):
    """Server-side refresh token record — revocable/rotatable, not a bare stateless JWT."""

    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    replaced_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("refresh_tokens.id", ondelete="SET NULL"), nullable=True
    )

    user: Mapped["User"] = relationship(back_populates="refresh_tokens")


class ExchangeCredential(Base):
    """Per-user, per-exchange API credentials — encrypted at rest, never exposed to the frontend."""

    __tablename__ = "exchange_credentials"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    exchange: Mapped[str] = mapped_column(String, nullable=False)  # e.g. "okx"
    is_demo: Mapped[bool] = mapped_column(nullable=False)  # OKX demo-trading vs live
    label: Mapped[str] = mapped_column(String, nullable=False, default="default")
    encrypted_payload: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)  # Fernet-encrypted JSON blob
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user: Mapped["User"] = relationship(back_populates="exchange_credentials")


class UserPreference(Base):
    """Per-user UI preferences synced across devices."""

    __tablename__ = "user_preferences"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    preferences: Mapped[dict] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"), nullable=False, default=dict
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    user: Mapped["User"] = relationship(back_populates="preferences")


class EtfFlow(Base):
    """Farside BTC ETF daily total net flow — context indicator only, no per-fund
    breakdown, no ETH data. observed_at is NULL for historical backfill rows and
    set to the scraper's first-observation time for genuinely new rows."""

    __tablename__ = "etf_flows"

    flow_date: Mapped[date] = mapped_column(Date, primary_key=True)
    total_net_flow: Mapped[float] = mapped_column(Numeric, nullable=False)
    observed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class LargeOrderLevel(Base):
    """One exchange L2 price-level lifecycle, captured after crossing $500K."""

    __tablename__ = "large_order_levels"
    __table_args__ = (
        Index(
            "uq_large_order_levels_active",
            "source",
            "symbol",
            "side",
            "price",
            unique=True,
            postgresql_where=text("ended_at IS NULL"),
        ),
        Index("ix_large_order_levels_history", "symbol", "first_seen", "ended_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source: Mapped[str] = mapped_column(String, nullable=False)
    symbol: Mapped[str] = mapped_column(String, nullable=False)
    side: Mapped[str] = mapped_column(String, nullable=False)
    price: Mapped[float] = mapped_column(Numeric, nullable=False)
    quantity: Mapped[float] = mapped_column(Numeric, nullable=False)
    current_notional: Mapped[float] = mapped_column(Numeric, nullable=False)
    peak_notional: Mapped[float] = mapped_column(Numeric, nullable=False)
    first_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
