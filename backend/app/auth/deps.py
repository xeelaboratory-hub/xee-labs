import jwt
from fastapi import Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import decode_access_token
from app.db.models import User
from app.db.session import get_db


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
