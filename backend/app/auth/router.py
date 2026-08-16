from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.auth.schemas import (
    AuthResponse,
    LoginRequest,
    LogoutRequest,
    RefreshRequest,
    RefreshResponse,
    RegisterRequest,
    UserOut,
)
from app.auth.security import (
    create_access_token,
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    verify_password,
)
from app.db.models import RefreshToken, User
from app.db.session import get_db

router = APIRouter(prefix="/api/auth")


def _user_out(user: User) -> UserOut:
    return UserOut(
        id=str(user.id),
        email=user.email,
        firstName=user.first_name,
        lastName=user.last_name,
        roles=["user"],
        status=user.status,
        createdAt=user.created_at.isoformat(),
    )


async def _issue_tokens(db: AsyncSession, user: User) -> tuple[str, str]:
    access_token = create_access_token(str(user.id))
    raw_refresh, token_hash, expires_at = generate_refresh_token()
    db.add(RefreshToken(user_id=user.id, token_hash=token_hash, expires_at=expires_at))
    await db.commit()
    return access_token, raw_refresh


@router.post("/register", response_model=AuthResponse)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)) -> AuthResponse:
    existing = await db.scalar(select(User).where(User.email == body.email))
    if existing is not None:
        raise HTTPException(status_code=409, detail="an account with this email already exists")

    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        first_name=body.firstName,
        last_name=body.lastName,
    )
    db.add(user)
    await db.flush()
    access_token, refresh_token = await _issue_tokens(db, user)
    return AuthResponse(accessToken=access_token, refreshToken=refresh_token, user=_user_out(user))


@router.post("/login", response_model=AuthResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)) -> AuthResponse:
    user = await db.scalar(select(User).where(User.email == body.email))
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="invalid email or password")
    if user.status != "active":
        raise HTTPException(status_code=403, detail="account is not active")

    access_token, refresh_token = await _issue_tokens(db, user)
    return AuthResponse(accessToken=access_token, refreshToken=refresh_token, user=_user_out(user))


@router.post("/refresh", response_model=RefreshResponse)
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(get_db)) -> RefreshResponse:
    token_hash = hash_refresh_token(body.refreshToken)
    record = await db.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))

    now = datetime.now(timezone.utc)
    if (
        record is None
        or record.revoked_at is not None
        or record.expires_at.replace(tzinfo=timezone.utc) < now
    ):
        raise HTTPException(status_code=401, detail="refresh token is invalid, expired, or revoked")

    user = await db.get(User, record.user_id)
    if user is None or user.status != "active":
        raise HTTPException(status_code=401, detail="user not found or inactive")

    # Rotate: revoke the used token and mint a new one, so a stolen-but-reused
    # refresh token is detectable (its replacement chain breaks) and every
    # token is single-use.
    access_token = create_access_token(str(user.id))
    raw_refresh, new_hash, expires_at = generate_refresh_token()
    new_record = RefreshToken(user_id=user.id, token_hash=new_hash, expires_at=expires_at)
    db.add(new_record)
    await db.flush()
    record.revoked_at = now
    record.replaced_by_id = new_record.id
    await db.commit()

    return RefreshResponse(accessToken=access_token, refreshToken=raw_refresh)


@router.post("/logout")
async def logout(body: LogoutRequest, db: AsyncSession = Depends(get_db)) -> dict[str, bool]:
    token_hash = hash_refresh_token(body.refreshToken)
    record = await db.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    if record is not None and record.revoked_at is None:
        record.revoked_at = datetime.now(timezone.utc)
        await db.commit()
    return {"success": True}


@router.get("/me", response_model=UserOut)
async def get_me(user: User = Depends(get_current_user)) -> UserOut:
    return _user_out(user)
