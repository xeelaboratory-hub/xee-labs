import os

# Set before any `app.*` module import (config.py reads these eagerly at
# import time) so test collection doesn't require a real .env/docker-compose.
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("CREDENTIAL_ENCRYPTION_KEY", "TOSjW4wAbvfJE25i3CU5ofCW_e-TKbftqNfTlyhoOF8=")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
