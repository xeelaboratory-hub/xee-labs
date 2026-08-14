"""Plain constants — no env/config framework needed at this scale."""

PORT = 3000
WS_PATH = "/ws"

EXCHANGES = ["binance", "okx"]
SYMBOL_BASES = ["BTC", "ETH"]
QUOTE = "USDT"

DEFAULT_TIMEFRAME = "1m"
SUPPORTED_TIMEFRAMES = {"1m"}

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
