"""OKX perpetual-swap channel config — live perpetuals via CryptoFeed."""
from cryptofeed.connection import WebsocketEndpoint
from cryptofeed.defines import CANDLES, FUNDING, L2_BOOK, LIQUIDATIONS, OPEN_INTEREST, ORDER_INFO, TICKER, TRADES
from cryptofeed.exchanges import OKX as _UpstreamOKX

from app.feeds._common import make_candle_callback, make_ticker_callback
from app.symbols import symbols_for_exchange

EXCHANGE = "okx"


class OKX(_UpstreamOKX):
    """OKX moved candlestick subscriptions to its `/business` WS endpoint;
    upstream cryptofeed 2.5.0 (latest on PyPI) still routes CANDLES to
    `/public`, which OKX now rejects with code 60018 ("Wrong URL or
    channel"). Verified directly against OKX's live WS gateway during the
    Phase 1 spike. Only the CANDLES channel moves — everything else is
    unchanged from upstream.
    """

    websocket_endpoints = [
        WebsocketEndpoint(
            "wss://ws.okx.com:8443/ws/v5/public",
            channel_filter=(
                _UpstreamOKX.websocket_channels[L2_BOOK],
                _UpstreamOKX.websocket_channels[TRADES],
                _UpstreamOKX.websocket_channels[TICKER],
                _UpstreamOKX.websocket_channels[FUNDING],
                _UpstreamOKX.websocket_channels[OPEN_INTEREST],
                _UpstreamOKX.websocket_channels[LIQUIDATIONS],
            ),
            options={"compression": None},
        ),
        WebsocketEndpoint(
            "wss://ws.okx.com:8443/ws/v5/business",
            channel_filter=(_UpstreamOKX.websocket_channels[CANDLES],),
            options={"compression": None},
        ),
        WebsocketEndpoint(
            "wss://ws.okx.com:8443/ws/v5/private",
            channel_filter=(_UpstreamOKX.websocket_channels[ORDER_INFO],),
            options={"compression": None},
        ),
    ]


def build_feed() -> OKX:
    cryptofeed_symbols = [info.cryptofeed_symbol for info in symbols_for_exchange(EXCHANGE)]
    return OKX(
        symbols=cryptofeed_symbols,
        channels=[TICKER, CANDLES],
        candle_interval="1m",
        candle_closed_only=False,
        retries=0,  # our own supervisor in cryptofeed_runner.py owns all reconnect/backoff policy
        callbacks={
            TICKER: make_ticker_callback(EXCHANGE),
            CANDLES: make_candle_callback(EXCHANGE),
        },
    )
