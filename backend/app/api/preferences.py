import json
import logging
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.db.models import User, UserPreference
from app.db.session import get_db

LOG = logging.getLogger("preferences")

router = APIRouter(prefix="/api/preferences")

_MAX_PAYLOAD_BYTES = 64 * 1024


_SessionMarket = Literal["ASX", "TOKYO", "LONDON", "NEW_YORK"]


class PreferencesPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chart: dict[str, str] = Field(default_factory=dict)
    bottomPanelCollapsed: bool | None = None
    rightPanelCollapsed: bool | None = None
    rightPanel: Literal["order", "dom", "watchlist", "ai-trader", "position-builder"] | None = None
    rightPanelWidth: int | None = Field(default=None, ge=240, le=520)
    bottomPanelHeight: int | None = Field(default=None, ge=100, le=800)
    oneClickTrading: bool | None = None
    timeframes: dict[str, str] = Field(default_factory=dict)
    activeIndicators: list[Literal["ETF_FLOW", "SESSION_VOLUME_PROFILE", "LARGE_ORDER_BOOK"]] = Field(
        default_factory=list, max_length=3
    )
    largeOrderBookThreshold: Literal[0, 500000, 1000000, 3000000, 5000000, 10000000] | None = None
    largeOrderBookSources: list[Literal["binance", "okx"]] | None = Field(default=None, max_length=2)
    largeOrderBookShowInactive: bool | None = None
    watchlistFavorites: list[str] = Field(default_factory=list, max_length=500)
    tradeSoundMuted: bool | None = None
    # Bounds mirror normalizeSessionVolumeProfileRows in services/preferences.ts;
    # the two must agree or a value the UI considers valid gets rejected here.
    sessionVolumeProfileRows: int | None = Field(default=None, ge=10, le=100)
    sessionVolumeProfileMarkets: list[_SessionMarket] | None = Field(default=None, max_length=4)
    # Superseded by the plural field above, still written by older clients.
    sessionVolumeProfileMarket: _SessionMarket | None = None
    tradingMode: Literal["demo", "live"] | None = None
    selectedSymbol: str | None = Field(default=None, max_length=100)


class PreferencesResponse(BaseModel):
    exists: bool
    preferences: PreferencesPayload
    updatedAt: datetime | None


def _read_stored(raw: Any) -> PreferencesPayload:
    """Reads a stored row without ever failing the request.

    Writes stay strict (extra="forbid") so a client typo can't quietly
    persist. Reads must not: this endpoint returned 500 for every request
    because a row held four keys the schema didn't know yet, which blocked
    preference loading entirely rather than degrading. A row written by a
    newer client, or holding a value this version no longer accepts, should
    cost the user those keys — not the whole response.
    """
    if not isinstance(raw, dict):
        LOG.warning("stored preferences are not an object (%s); using defaults", type(raw).__name__)
        return PreferencesPayload()
    try:
        return PreferencesPayload.model_validate(raw)
    except ValidationError as exc:
        rejected = {str(err["loc"][0]) for err in exc.errors() if err.get("loc")}
        LOG.warning("dropping unreadable preference keys: %s", sorted(rejected))
        try:
            return PreferencesPayload.model_validate(
                {k: v for k, v in raw.items() if k not in rejected}
            )
        except ValidationError:
            LOG.warning("stored preferences unreadable; using defaults")
            return PreferencesPayload()


def _validate_size(payload: PreferencesPayload) -> None:
    encoded = json.dumps(payload.model_dump(exclude_none=True), separators=(",", ":")).encode()
    if len(encoded) > _MAX_PAYLOAD_BYTES:
        raise HTTPException(status_code=413, detail="preferences payload exceeds 64 KiB")


@router.get("", response_model=PreferencesResponse, response_model_exclude_none=True)
async def get_preferences(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> PreferencesResponse:
    row = await db.get(UserPreference, user.id)
    if row is None:
        return PreferencesResponse(exists=False, preferences=PreferencesPayload(), updatedAt=None)
    return PreferencesResponse(
        exists=True,
        preferences=_read_stored(row.preferences),
        updatedAt=row.updated_at,
    )


@router.put("", response_model=PreferencesResponse, response_model_exclude_none=True)
async def save_preferences(
    body: PreferencesPayload,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PreferencesResponse:
    _validate_size(body)
    payload = body.model_dump(exclude_none=True)
    row = await db.get(UserPreference, user.id)
    if row is None:
        row = UserPreference(user_id=user.id, preferences=payload)
        db.add(row)
    else:
        row.preferences = payload
    await db.commit()
    await db.refresh(row)
    return PreferencesResponse(exists=True, preferences=body, updatedAt=row.updated_at)
