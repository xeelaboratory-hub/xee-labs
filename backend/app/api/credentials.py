from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.db.models import ExchangeCredential, User
from app.db.session import get_db
from app.security.encryption import encrypt_json

router = APIRouter(prefix="/api/credentials")

_SUPPORTED_EXCHANGES = {"okx"}


class CreateCredentialRequest(BaseModel):
    exchange: str
    isDemo: bool
    apiKey: str
    apiSecret: str
    passphrase: str
    label: str = "default"


class CredentialOut(BaseModel):
    id: str
    exchange: str
    isDemo: bool
    label: str
    createdAt: str


def _out(cred: ExchangeCredential) -> CredentialOut:
    return CredentialOut(
        id=str(cred.id),
        exchange=cred.exchange,
        isDemo=cred.is_demo,
        label=cred.label,
        createdAt=cred.created_at.isoformat(),
    )


@router.get("", response_model=list[CredentialOut])
async def list_credentials(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> list[CredentialOut]:
    rows = await db.scalars(select(ExchangeCredential).where(ExchangeCredential.user_id == user.id))
    return [_out(c) for c in rows]


@router.post("", response_model=CredentialOut, status_code=201)
async def create_credential(
    body: CreateCredentialRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CredentialOut:
    if body.exchange not in _SUPPORTED_EXCHANGES:
        raise HTTPException(status_code=400, detail=f"unsupported exchange: {body.exchange}")

    payload = encrypt_json(
        {"apiKey": body.apiKey, "apiSecret": body.apiSecret, "passphrase": body.passphrase}
    )
    cred = ExchangeCredential(
        user_id=user.id,
        exchange=body.exchange,
        is_demo=body.isDemo,
        label=body.label,
        encrypted_payload=payload,
    )
    db.add(cred)
    await db.commit()
    await db.refresh(cred)
    return _out(cred)


@router.delete("/{credential_id}", status_code=204)
async def delete_credential(
    credential_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    cred = await db.get(ExchangeCredential, credential_id)
    if cred is None or cred.user_id != user.id:
        raise HTTPException(status_code=404, detail="credential not found")
    await db.delete(cred)
    await db.commit()
