import jwt
from fastapi import Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession

from app import config
from app.auth.security import decode_access_token
from app.db.models import User
from app.db.session import get_db


def require_registration_open() -> None:
    """Blocks self-service signup unless this instance is meant to accept it.

    Read off the module rather than imported by value, so the flag can be
    flipped at runtime (and in tests) instead of being frozen at import.
    """
    if not config.REGISTRATION_OPEN:
        raise HTTPException(status_code=403, detail="registration is closed on this instance")


async def get_current_user(
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = authorization.removeprefix("Bearer ")
    try:
        user_id = decode_access_token(token)
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="invalid or expired token")

    user = await db.get(User, user_id)
    if user is None or user.status != "active":
        raise HTTPException(status_code=401, detail="user not found or inactive")
    return user
