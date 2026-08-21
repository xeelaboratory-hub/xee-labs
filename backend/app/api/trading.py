import logging
from typing import Literal

from pydantic import BaseModel, Field, model_validator
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.db.models import ExchangeCredential, User
from app.db.session import get_db
from app.exchange.errors import ExchangeError
from app.exchange.mapping import (
    okx_balance_to_account,
    okx_fill_to_trade_history_entry,
    okx_order_to_order,
    okx_position_to_position,
)
from app.exchange.okx_client import OKXClient
from app.security.encryption import decrypt_json
from app.symbols import get_symbol

LOG = logging.getLogger("trading")

router = APIRouter(prefix="/api")

Mode = Literal["demo", "live"]


def _log_exchange_error(operation: str, *, exchange: str, user: User, mode: Mode, exc: ExchangeError) -> None:
    # Never include exc.args beyond the message OKX/httpx already put there —
    # verified (see okx_client.py) that path never embeds api_key/api_secret/
    # passphrase. Bounded length as a defensive cap, not because a secret is
    # expected to show up here.
    LOG.warning(
        "exchange_error operation=%s exchange=%s mode=%s user_id=%s code=%s message=%s",
        operation,
        exchange,
        mode,
        user.id,
        exc.code,
        str(exc)[:300],
    )


async def _get_okx_client(mode: Mode, user: User, db: AsyncSession) -> OKXClient:
    cred = await db.scalar(
        select(ExchangeCredential).where(
            ExchangeCredential.user_id == user.id,
            ExchangeCredential.exchange == "okx",
            ExchangeCredential.is_demo == (mode == "demo"),
        )
    )
    if cred is None:
        raise HTTPException(
            status_code=404, detail=f"no OKX {mode} credentials configured for this account"
        )
    secrets = decrypt_json(cred.encrypted_payload)
    return OKXClient(
        api_key=secrets["apiKey"],
        api_secret=secrets["apiSecret"],
        passphrase=secrets["passphrase"],
        is_demo=(mode == "demo"),
    )


class PlaceOrderRequest(BaseModel):
    symbol: str  # our symbol id, e.g. "OKX:BTCUSD" — not the exchange's own instId
    side: Literal["BUY", "SELL"]
    type: Literal["MARKET", "LIMIT"]
    # Defense-in-depth before this ever reaches OKX: reject non-positive,
    # NaN, and +/-Infinity. `gt=0` alone isn't enough for the infinity case —
    # `inf > 0` is true — and standard JSON parsing (what Starlette uses for
    # request bodies) accepts bare `NaN`/`Infinity` tokens, so this isn't a
    # theoretical gap.
    quantity: float = Field(gt=0, allow_inf_nan=False)
    price: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    # Protective bracket, attached to the entry order itself via OKX's
    # `attachAlgoOrds` (see okx_client._attach_algo_ords). Same gt/allow_inf_nan
    # defense as quantity and price — these become trigger prices at the
    # exchange, so a NaN reaching OKX is not a theoretical concern.
    takeProfit: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    stopLoss: float | None = Field(default=None, gt=0, allow_inf_nan=False)

    @model_validator(mode="after")
    def _limit_orders_require_a_price(self) -> "PlaceOrderRequest":
        # Mirrors PositionBuilderPanel's existing client-side rule
        # (validateOrderInput) — not a new business rule, just enforcing the
        # same contract server-side.
        if self.type == "LIMIT" and self.price is None:
            raise ValueError("price is required for LIMIT orders")
        return self

    @model_validator(mode="after")
    def _bracket_must_straddle_the_limit_price(self) -> "PlaceOrderRequest":
        """A stop-loss on the profitable side of the entry (or a take-profit on
        the losing side) triggers the instant the order fills, closing the
        position it was meant to protect. OKX rejects some of these itself, but
        not uniformly, so catch it here where the error can name the field.

        Only LIMIT orders are checked: a MARKET order has no server-side entry
        price to compare against — it fills at whatever the book gives it. The
        client validates those against the live tick (`validateOrderInput`),
        which is the only reference either side actually has.
        """
        if self.type != "LIMIT" or self.price is None:
            return self
        if self.side == "BUY":
            if self.stopLoss is not None and self.stopLoss >= self.price:
                raise ValueError("stopLoss must be below the limit price for a BUY order")
            if self.takeProfit is not None and self.takeProfit <= self.price:
                raise ValueError("takeProfit must be above the limit price for a BUY order")
        else:
            if self.stopLoss is not None and self.stopLoss <= self.price:
                raise ValueError("stopLoss must be above the limit price for a SELL order")
            if self.takeProfit is not None and self.takeProfit >= self.price:
                raise ValueError("takeProfit must be below the limit price for a SELL order")
        return self


class ClosePositionRequest(BaseModel):
    symbol: str  # our symbol id, e.g. "OKX:BTCUSD"
    posSide: Literal["long", "short", "net"]  # OKX's raw posSide — used verbatim for a full close
    side: Literal["LONG", "SHORT"]  # our derived side — picks the reduce-only order direction
    quantity: float | None = Field(default=None, gt=0, allow_inf_nan=False)  # omit for a full close


_CLOSING_ORDER_SIDE = {"LONG": "sell", "SHORT": "buy"}


def _okx_native_symbol(symbol: str) -> str:
    """Our symbol id ("OKX:BTCUSD") -> OKX's own instId ("BTC-USDT-SWAP")."""
    info = get_symbol(symbol)
    if info is None or info.exchange != "okx":
        raise HTTPException(status_code=400, detail=f"unknown OKX symbol: {symbol}")
    return info.native_symbol


@router.get("/account")
async def get_account(
    mode: Mode = Query(...), user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> dict:
    client = await _get_okx_client(mode, user, db)
    try:
        balance = await client.get_balance()
    except ExchangeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return okx_balance_to_account(balance)


@router.get("/positions")
async def get_positions(
    mode: Mode = Query(...), user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> list[dict]:
    client = await _get_okx_client(mode, user, db)
    try:
        positions = await client.get_positions()
    except ExchangeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return [okx_position_to_position(p) for p in positions if float(p.get("pos") or 0) != 0]


@router.get("/orders")
async def get_orders(
    mode: Mode = Query(...), user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> list[dict]:
    client = await _get_okx_client(mode, user, db)
    try:
        orders = await client.get_open_orders()
    except ExchangeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return [okx_order_to_order(o) for o in orders]


@router.post("/orders", status_code=201)
async def place_order(
    body: PlaceOrderRequest,
    mode: Mode = Query(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    client = await _get_okx_client(mode, user, db)
    inst_id = _okx_native_symbol(body.symbol)
    try:
        result = await client.place_order(
            inst_id=inst_id,
            side=body.side.lower(),
            ord_type=body.type.lower(),
            size=str(body.quantity),
            price=str(body.price) if body.price is not None else None,
            tp_trigger_px=str(body.takeProfit) if body.takeProfit is not None else None,
            sl_trigger_px=str(body.stopLoss) if body.stopLoss is not None else None,
        )
    except ExchangeError as exc:
        _log_exchange_error("place_order", exchange="okx", user=user, mode=mode, exc=exc)
        raise HTTPException(status_code=502, detail=str(exc))
    if not result or result[0].get("sCode") != "0":
        msg = result[0].get("sMsg") if result else "order placement failed"
        raise HTTPException(status_code=502, detail=msg)
    return {"orderId": result[0]["ordId"]}


@router.post("/positions/close")
async def close_position(
    body: ClosePositionRequest,
    mode: Mode = Query(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    client = await _get_okx_client(mode, user, db)
    inst_id = _okx_native_symbol(body.symbol)
    try:
        if body.quantity is None:
            result = await client.close_position(inst_id=inst_id, pos_side=body.posSide)
        else:
            result = await client.place_reduce_only_order(
                inst_id=inst_id,
                side=_CLOSING_ORDER_SIDE[body.side],
                size=str(body.quantity),
            )
    except ExchangeError as exc:
        _log_exchange_error("close_position", exchange="okx", user=user, mode=mode, exc=exc)
        raise HTTPException(status_code=502, detail=str(exc))
    if not result or result[0].get("sCode") not in ("0", None):
        msg = result[0].get("sMsg") if result else "position close failed"
        raise HTTPException(status_code=502, detail=msg)
    return {"success": True}


@router.get("/trades/history")
async def get_trade_history(
    mode: Mode = Query(...), user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> list[dict]:
    client = await _get_okx_client(mode, user, db)
    try:
        fills = await client.get_fills_history()
    except ExchangeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return [okx_fill_to_trade_history_entry(f) for f in fills]


@router.delete("/orders/{order_id}")
async def cancel_order(
    order_id: str,
    symbol: str = Query(..., description="Our symbol id the order belongs to, e.g. 'OKX:BTCUSD'"),
    mode: Mode = Query(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    client = await _get_okx_client(mode, user, db)
    inst_id = _okx_native_symbol(symbol)
    try:
        result = await client.cancel_order(inst_id=inst_id, order_id=order_id)
    except ExchangeError as exc:
        _log_exchange_error("cancel_order", exchange="okx", user=user, mode=mode, exc=exc)
        raise HTTPException(status_code=502, detail=str(exc))
    if not result or result[0].get("sCode") != "0":
        msg = result[0].get("sMsg") if result else "order cancellation failed"
        raise HTTPException(status_code=502, detail=msg)
    return {"success": True}
