"""Maps raw OKX v5 REST payloads onto Xee.Labs' trading domain shapes.

Field names are chosen to line up with the existing (PropSim-era)
services/schemas.ts where the concept genuinely carries over (symbolName,
side, quantity, entryPrice, ...). Fields with no real-exchange equivalent
(accountId, templateId, phase, comment, stopPrice) are simply not emitted —
schemas.ts needs those made optional/removed to match (tracked separately).
"""
from datetime import datetime, timezone
from typing import Any

from app.symbols import resolve_from_native

_OKX_SIDE_TO_SCHEMA = {"buy": "BUY", "sell": "SELL"}
_OKX_ORD_TYPE_TO_SCHEMA = {"market": "MARKET", "limit": "LIMIT", "post_only": "LIMIT"}
_OKX_STATE_TO_SCHEMA = {
    "live": "OPEN",
    "partially_filled": "PARTIALLY_FILLED",
    "filled": "FILLED",
    "canceled": "CANCELLED",
}


def _symbol_id(inst_id: str | None) -> str:
    """OKX instId ("BTC-USDT-SWAP") -> our symbol id ("OKX:BTCUSD"). Falls back
    to the raw instId for anything outside our tracked symbol set (shouldn't
    happen given only BTC/ETH SWAP are traded, but stays graceful either way)."""
    if not inst_id:
        return ""
    info = resolve_from_native("okx", inst_id)
    return info.id if info else inst_id


def _ms_to_iso(ms: str | None) -> str:
    if not ms:
        return datetime.now(timezone.utc).isoformat()
    return datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc).isoformat()


def okx_balance_to_account(balance_data: list[dict[str, Any]]) -> dict[str, Any]:
    if not balance_data:
        return {"balance": 0.0, "equity": 0.0, "margin": 0.0, "freeMargin": 0.0}
    entry = balance_data[0]
    total_eq = float(entry.get("totalEq") or 0)
    imr = float(entry.get("imr") or 0)
    return {
        "balance": total_eq,
        "equity": total_eq,
        "margin": imr,
        "freeMargin": total_eq - imr,
    }


def okx_position_to_position(p: dict[str, Any]) -> dict[str, Any]:
    pos_side = p.get("posSide", "net")
    pos = float(p.get("pos") or 0)
    side = "LONG" if pos_side == "long" or (pos_side == "net" and pos >= 0) else "SHORT"
    # id carries both OKX's raw posSide (needed verbatim for a full close-position
    # call — "net" must not be coerced to long/short) and our derived LONG/SHORT
    # (needed to pick a reduce-only order direction for a partial close).
    return {
        "id": f"{_symbol_id(p.get('instId'))}:{pos_side}:{side.lower()}",
        "symbolName": _symbol_id(p.get("instId")),
        "side": side,
        "quantity": abs(pos),
        "entryPrice": float(p.get("avgPx") or 0),
        "currentPrice": float(p.get("last") or 0) if p.get("last") else None,
        "unrealizedPnl": float(p.get("upl") or 0),
        "margin": float(p.get("margin") or 0),
        "openedAt": _ms_to_iso(p.get("cTime")),
        "takeProfit": None,
        "stopLoss": None,
    }


def okx_fill_to_trade_history_entry(f: dict[str, Any]) -> dict[str, Any]:
    """OKX's fills-history is a flat list of executions, not paired open/close
    events — there is no honest "entry vs exit price" to report per row, so this
    is a single-price trade log rather than schemas.ts's open/close ClosedPosition
    shape."""
    return {
        "id": f.get("tradeId") or f.get("billId"),
        "symbolName": _symbol_id(f.get("instId")),
        "side": _OKX_SIDE_TO_SCHEMA.get(f.get("side"), f.get("side")),
        "quantity": float(f.get("fillSz") or 0),
        "price": float(f.get("fillPx") or 0),
        "fee": abs(float(f.get("fee") or 0)),
        "realizedPnl": float(f.get("pnl") or 0),
        "timestamp": _ms_to_iso(f.get("ts")),
    }


def okx_order_to_order(o: dict[str, Any]) -> dict[str, Any]:
    sz = float(o.get("sz") or 0)
    fill_sz = float(o.get("fillSz") or 0)
    px = o.get("px")
    avg_px = o.get("avgPx")
    return {
        "id": o.get("ordId"),
        "symbolName": _symbol_id(o.get("instId")),
        "side": _OKX_SIDE_TO_SCHEMA.get(o.get("side"), o.get("side")),
        "type": _OKX_ORD_TYPE_TO_SCHEMA.get(o.get("ordType"), "MARKET"),
        "quantity": sz,
        "price": float(px) if px else None,
        "status": _OKX_STATE_TO_SCHEMA.get(o.get("state"), o.get("state")),
        "filledQuantity": fill_sz,
        "avgFillPrice": float(avg_px) if avg_px else None,
        "createdAt": _ms_to_iso(o.get("cTime")),
        "updatedAt": _ms_to_iso(o.get("uTime")),
    }
