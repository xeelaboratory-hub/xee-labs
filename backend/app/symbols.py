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


@dataclass(frozen=True)
class SymbolInfo:
    id: str  # "BINANCE:BTCUSD"
    exchange: str  # "binance" | "okx"
    base: str  # "BTC"
    name: str  # "BTCUSD"
    display_name: str  # "Bitcoin"
    cryptofeed_symbol: str  # "BTC-USDT-PERP" — CryptoFeed's exchange-agnostic normalized form
    native_symbol: str  # exchange's own REST symbol: "BTCUSDT" (Binance) | "BTC-USDT-SWAP" (OKX)

    def to_schema(self) -> Symbol:
        return Symbol(
            id=self.id,
            name=self.name,
            displayName=self.display_name,
            exchange=self.exchange,
            category="CRYPTO",
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
                name=f"{base}USD",
                display_name=_DISPLAY_NAMES[base],
                cryptofeed_symbol=f"{base}-{QUOTE}-PERP",
                native_symbol=_native_symbol(exchange, base),
            )
    return registry


SYMBOLS: dict[str, SymbolInfo] = _build_registry()

# (exchange, cryptofeed_symbol) -> our id, for mapping live callback payloads
# (which carry CryptoFeed's normalized symbol, not our id) back to a SymbolInfo.
_BY_EXCHANGE_AND_CRYPTOFEED_SYMBOL: dict[tuple[str, str], str] = {
    (info.exchange, info.cryptofeed_symbol): info.id for info in SYMBOLS.values()
}


def get_symbol(symbol_id: str) -> SymbolInfo | None:
    return SYMBOLS.get(symbol_id)


def list_symbols() -> list[SymbolInfo]:
    return list(SYMBOLS.values())


def resolve_from_feed(exchange: str, cryptofeed_symbol: str) -> SymbolInfo | None:
    symbol_id = _BY_EXCHANGE_AND_CRYPTOFEED_SYMBOL.get((exchange, cryptofeed_symbol))
    return SYMBOLS.get(symbol_id) if symbol_id else None


def symbols_for_exchange(exchange: str) -> list[SymbolInfo]:
    return [info for info in SYMBOLS.values() if info.exchange == exchange]
