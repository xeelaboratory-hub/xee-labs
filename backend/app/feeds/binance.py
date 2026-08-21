"""Binance USDⓈ-M futures channel config — live perpetuals via CryptoFeed."""
from cryptofeed.defines import CANDLES, L2_BOOK, TICKER
from cryptofeed.exchanges import BinanceFutures

from app.config import CONNECTION_RETRIES
from app.feeds._common import make_book_callback, make_candle_callback, make_ticker_callback
from app.symbols import symbols_for_exchange

EXCHANGE = "binance"


def build_feed() -> BinanceFutures:
    cryptofeed_symbols = [info.cryptofeed_symbol for info in symbols_for_exchange(EXCHANGE)]
    return BinanceFutures(
        symbols=cryptofeed_symbols,
        channels=[TICKER, CANDLES, L2_BOOK],
        candle_interval="1m",
        candle_closed_only=False,  # we want in-progress updates for CandleUpdate, not just closes
        retries=CONNECTION_RETRIES,  # per-connection self-heal; see config.py
        callbacks={
            TICKER: make_ticker_callback(EXCHANGE),
            CANDLES: make_candle_callback(EXCHANGE),
            L2_BOOK: make_book_callback(EXCHANGE),
        },
    )
