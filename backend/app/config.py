"""Plain constants — no env/config framework needed at this scale."""

PORT = 3000
WS_PATH = "/ws"

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
RECONNECT_BASE_DELAY_SECONDS = 1
RECONNECT_MAX_DELAY_SECONDS = 30

# Number of recent 1m candles replayed to a client on fresh WS subscription,
# since Phase 1/2 has no persistence to fill a reconnect gap otherwise.
WS_WARMUP_CANDLE_COUNT = 500

# Historical REST response cache TTL — protects exchange rate limits against
# ChartPanel's fast scroll-back pagination re-requesting the same range.
HISTORICAL_CACHE_TTL_SECONDS = 5
HISTORICAL_CACHE_MAX_ENTRIES = 256

BINANCE_KLINES_URL = "https://fapi.binance.com/fapi/v1/klines"
OKX_CANDLES_URL = "https://www.okx.com/api/v5/market/history-candles"
