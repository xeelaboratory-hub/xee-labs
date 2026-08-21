"""Plain constants — no env/config framework needed at this scale."""

import os

PORT = 3000
WS_PATH = "/ws"

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_TTL_SECONDS = 15 * 60
REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60

CREDENTIAL_ENCRYPTION_KEY = os.environ["CREDENTIAL_ENCRYPTION_KEY"]


def _env_flag(name: str) -> bool:
    """Reads a boolean env var, treating only explicit affirmatives as true.

    An unset, empty, or misspelled value fails closed rather than open — which
    matters for the one flag that uses this: a typo must not be the thing that
    opens self-service registration.
    """
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


# Self-service registration, off unless asked for. The frontend container
# publishes :8080 on every interface, so anything reachable on the local
# network can reach `/api/auth/register` through nginx — and this instance
# serves a single operator account, not customers. An open registration
# endpoint is a path from "someone on the network" to "authenticated user"
# that nothing here needs yet.
#
# Turn it on (`REGISTRATION_OPEN=true`) when the product actually sells
# accounts; the signup half of a paid release cannot work without it.
REGISTRATION_OPEN = _env_flag("REGISTRATION_OPEN")

EXCHANGES = ["binance", "okx"]
SYMBOL_BASES = ["BTC", "ETH"]
QUOTE = "USDT"

DEFAULT_TIMEFRAME = "1m"
SUPPORTED_TIMEFRAMES = {"1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"}

# Per-exchange REST interval vocabulary. Binance futures klines already use
# these strings verbatim; OKX's `bar` param capitalizes the hour/day/week
# suffix. Only entries that differ from the generic timeframe need listing —
# lookup falls back to the generic string itself.
TIMEFRAME_MAP: dict[str, dict[str, str]] = {
    "binance": {},
    "okx": {"1h": "1H", "4h": "4H", "1d": "1D", "1w": "1W"},
}

# Reconnect backoff for each exchange's CryptoFeed connection.
# Per-connection reconnect attempts inside cryptofeed before it gives up on a
# socket and leaves recovery to the supervisor in feeds/cryptofeed_runner.py.
#
# Must stay > 0. cryptofeed's ConnectionHandler loops `while retries <=
# self.retries`, so at 0 a single abrupt EOF retires that connection for good
# ("failed to reconnect after 1 retries - exiting"). OKX's /public socket does
# exactly that every few minutes, and because candles ride a separate
# /business socket that survives, the feed kept looking alive while ticker and
# book were dead — the 37-minute price freeze that mispriced a live position.
#
# A finite count keeps the layering intact: cryptofeed absorbs transient drops
# in about a second, while a genuinely broken feed still exhausts its retries
# and escalates to the supervisor, which owns backoff and full-feed rebuilds.
CONNECTION_RETRIES = 10

RECONNECT_BASE_DELAY_SECONDS = 1
RECONNECT_MAX_DELAY_SECONDS = 30

# Historical REST response cache TTL — protects exchange rate limits against
# ChartPanel's fast scroll-back pagination re-requesting the same range.
HISTORICAL_CACHE_TTL_SECONDS = 5
HISTORICAL_CACHE_MAX_ENTRIES = 256

BINANCE_KLINES_URL = "https://fapi.binance.com/fapi/v1/klines"
OKX_CANDLES_URL = "https://www.okx.com/api/v5/market/history-candles"
OKX_INSTRUMENTS_URL = "https://www.okx.com/api/v5/public/instruments"

# Instrument specs (ctVal/lotSz/minSz/tickSz/maxLever) change rarely — long TTL
# relative to HISTORICAL_CACHE_TTL_SECONDS above.
INSTRUMENT_CACHE_TTL_SECONDS = 3600
