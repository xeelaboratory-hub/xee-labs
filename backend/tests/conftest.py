import os

# Set before any `app.*` module import (config.py reads these eagerly at
# import time) so test collection doesn't require a real .env/docker-compose.
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("CREDENTIAL_ENCRYPTION_KEY", "TOSjW4wAbvfJE25i3CU5ofCW_e-TKbftqNfTlyhoOF8=")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")

import pytest  # noqa: E402

from app import config  # noqa: E402


@pytest.fixture
def open_registration(monkeypatch):
    """Opens self-service signup for one test.

    `config.REGISTRATION_OPEN` is off by default (see the comment there), so a
    test that exercises registration itself has to say so — rather than the
    suite quietly running against a configuration no deployment uses.
    """
    monkeypatch.setattr(config, "REGISTRATION_OPEN", True)
