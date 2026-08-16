import json
from typing import Any

from cryptography.fernet import Fernet

from app.config import CREDENTIAL_ENCRYPTION_KEY

_fernet = Fernet(CREDENTIAL_ENCRYPTION_KEY.encode())


def encrypt_json(payload: dict[str, Any]) -> bytes:
    return _fernet.encrypt(json.dumps(payload).encode())


def decrypt_json(blob: bytes) -> dict[str, Any]:
    return json.loads(_fernet.decrypt(blob).decode())
