import json
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.db.models import User, UserPreference
from app.db.session import get_db

router = APIRouter(prefix="/api/preferences")

_MAX_PAYLOAD_BYTES = 64 * 1024


class PreferencesPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chart: dict[str, str] = Field(default_factory=dict)
    bottomPanelCollapsed: bool | None = None
    rightPanelCollapsed: bool | None = None
    rightPanel: Literal["order", "dom", "watchlist", "ai-trader"] | None = None
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
    tradingMode: Literal["demo", "live"] | None = None
    selectedSymbol: str | None = Field(default=None, max_length=100)


class PreferencesResponse(BaseModel):
    exists: bool
    preferences: PreferencesPayload
    updatedAt: datetime | None


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
        preferences=PreferencesPayload.model_validate(row.preferences),
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
