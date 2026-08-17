"""(exchange, base) -> Symbol registry, plus the exchange-native ticker
mappings needed by feeds/* (CryptoFeed's own normalized symbol) and
historical/* (each exchange's raw REST symbol format).

Each (exchange, base) pair is its own flat, independently-addressable entry —
"BINANCE:BTCUSD" and "OKX:BTCUSD" are two distinct symbols, never merged.
"""
from dataclasses import dataclass

from app.config import QUOTE, SYMBOL_BASES
from app.schemas import Symbol

_DISPLAY_NAMES = {"BTC": "Bitcoin", "ETH": "Ethereum"}

# Trading metadata the frontend's paper-trading engine needs (margin/PnL math,
# price formatting). Mirrors src/services/demo/instruments.ts's BTC/ETH values
# so paper-trading behavior is unchanged by the real-data cutover. Static by
# design — no exchangeInfo fetching (see Phase 3 plan decision #2).
_TRADING_META = {
    "BTC": {"tickSize": 0.01, "tickValue": 0.01, "marginPercent": 1, "maxLeverage": 100},
    "ETH": {"tickSize": 0.01, "tickValue": 0.01, "marginPercent": 1, "maxLeverage": 100},
}


@dataclass(frozen=True)
class SymbolInfo:
    id: str  # "BINANCE:BTCUSD"
    exchange: str  # "binance" | "okx"
    base: str  # "BTC"
    name: str  # == id — see Symbol.name docstring
    display_name: str  # "Bitcoin"
    cryptofeed_symbol: str  # "BTC-USDT-PERP" — CryptoFeed's exchange-agnostic normalized form
    native_symbol: str  # exchange's own REST symbol: "BTCUSDT" (Binance) | "BTC-USDT-SWAP" (OKX)
    book_size_multiplier: float  # CryptoFeed L2 size -> base asset quantity

    def to_schema(self) -> Symbol:
        meta = _TRADING_META[self.base]
        return Symbol(
            id=self.id,
            name=self.name,
            displayName=self.display_name,
            exchange=self.exchange,
            category="CRYPTO",
            contractSize=1,
            tickSize=meta["tickSize"],
            tickValue=meta["tickValue"],
            marginPercent=meta["marginPercent"],
            maxLeverage=meta["maxLeverage"],
            commission=0,
            swapLong=0,
            swapShort=0,
            tradingHoursStart=None,
            tradingHoursEnd=None,
            isActive=True,
        )


def _native_symbol(exchange: str, base: str) -> str:
    if exchange == "binance":
        return f"{base}{QUOTE}"
    if exchange == "okx":
        return f"{base}-{QUOTE}-SWAP"
    raise ValueError(f"unknown exchange: {exchange}")


def _build_registry() -> dict[str, SymbolInfo]:
    registry: dict[str, SymbolInfo] = {}
    for exchange in ("binance", "okx"):
        for base in SYMBOL_BASES:
            symbol_id = f"{exchange.upper()}:{base}USD"
            registry[symbol_id] = SymbolInfo(
                id=symbol_id,
                exchange=exchange,
                base=base,
                name=symbol_id,
                display_name=_DISPLAY_NAMES[base],
                cryptofeed_symbol=f"{base}-{QUOTE}-PERP",
                native_symbol=_native_symbol(exchange, base),
                # Binance futures publishes base-asset quantity. OKX swap books
                # publish contracts (ctVal: 0.01 BTC, 0.1 ETH).
                book_size_multiplier=1 if exchange == "binance" else (0.01 if base == "BTC" else 0.1),
            )
    return registry


SYMBOLS: dict[str, SymbolInfo] = _build_registry()

# (exchange, cryptofeed_symbol) -> our id, for mapping live callback payloads
# (which carry CryptoFeed's normalized symbol, not our id) back to a SymbolInfo.
_BY_EXCHANGE_AND_CRYPTOFEED_SYMBOL: dict[tuple[str, str], str] = {
    (info.exchange, info.cryptofeed_symbol): info.id for info in SYMBOLS.values()
}

# (exchange, native_symbol) -> our id, for mapping trading-API responses
# (positions/orders/fills carry the exchange's own instId, e.g. "BTC-USDT-SWAP")
# back to our symbol id ("OKX:BTCUSD") so the frontend can navigate to them.
_BY_EXCHANGE_AND_NATIVE_SYMBOL: dict[tuple[str, str], str] = {
    (info.exchange, info.native_symbol): info.id for info in SYMBOLS.values()
}


def get_symbol(symbol_id: str) -> SymbolInfo | None:
    return SYMBOLS.get(symbol_id)


def list_symbols() -> list[SymbolInfo]:
    return list(SYMBOLS.values())


def resolve_from_feed(exchange: str, cryptofeed_symbol: str) -> SymbolInfo | None:
    symbol_id = _BY_EXCHANGE_AND_CRYPTOFEED_SYMBOL.get((exchange, cryptofeed_symbol))
    return SYMBOLS.get(symbol_id) if symbol_id else None


def resolve_from_native(exchange: str, native_symbol: str) -> SymbolInfo | None:
    symbol_id = _BY_EXCHANGE_AND_NATIVE_SYMBOL.get((exchange, native_symbol))
    return SYMBOLS.get(symbol_id) if symbol_id else None


def symbols_for_exchange(exchange: str) -> list[SymbolInfo]:
    return [info for info in SYMBOLS.values() if info.exchange == exchange]
