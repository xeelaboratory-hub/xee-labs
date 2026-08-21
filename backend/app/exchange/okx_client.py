"""Minimal OKX v5 REST client — balance, positions, orders. Supports both
live trading and OKX's Demo Trading environment (same base URL, distinguished
by the `x-simulated-trading: 1` header — see OKX docs)."""
import base64
import hashlib
import hmac
import json
from datetime import datetime, timezone
from typing import Any

import httpx

from app.exchange.errors import ExchangeError

OKX_BASE_URL = "https://www.okx.com"

# OKX's per-order rejection codes that callers act on rather than just report.
# `clOrdId` is checked for uniqueness against pending orders only, so a
# duplicate is a definitive "this exact order is already working" — not a
# transient failure to retry.
DUPLICATE_CLIENT_ORDER_ID = "51016"
ORDER_DOES_NOT_EXIST = "51603"


def _attach_algo_ords(*, tp_trigger_px: str | None, sl_trigger_px: str | None) -> dict[str, Any] | None:
    """Builds OKX's `attachAlgoOrds` entry — the take-profit/stop-loss bracket
    that rides along with the entry order itself, rather than being placed as a
    separate algo order afterwards.

    Two details are load-bearing:

    - `tpOrdPx`/`slOrdPx` are `"-1"`, OKX's sentinel for "execute at market when
      triggered." Omitting them makes the trigger place a *limit* order at an
      unset price, which OKX rejects; setting a real price would mean the
      protective exit can go unfilled in exactly the fast move it exists for.
    - `*TriggerPxType` is pinned to `"last"` rather than left to OKX's default,
      so the trigger reference matches the last-price feed the chart and the
      Position Builder's stop model are both built on. Mark price would trigger
      off a number the user never saw.

    Returns None when neither side is set, so the caller omits the key entirely
    instead of sending an empty bracket.
    """
    if tp_trigger_px is None and sl_trigger_px is None:
        return None
    attached: dict[str, Any] = {}
    if tp_trigger_px is not None:
        attached["tpTriggerPx"] = tp_trigger_px
        attached["tpOrdPx"] = "-1"
        attached["tpTriggerPxType"] = "last"
    if sl_trigger_px is not None:
        attached["slTriggerPx"] = sl_trigger_px
        attached["slOrdPx"] = "-1"
        attached["slTriggerPxType"] = "last"
    return attached


class OKXClient:
    def __init__(self, api_key: str, api_secret: str, passphrase: str, is_demo: bool):
        self._api_key = api_key
        self._api_secret = api_secret
        self._passphrase = passphrase
        self._is_demo = is_demo

    def _timestamp(self) -> str:
        return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

    def _sign(self, timestamp: str, method: str, request_path: str, body: str) -> str:
        message = f"{timestamp}{method}{request_path}{body}"
        digest = hmac.new(self._api_secret.encode(), message.encode(), hashlib.sha256).digest()
        return base64.b64encode(digest).decode()

    async def _request(
        self, method: str, path: str, *, params: dict[str, Any] | None = None, body: dict[str, Any] | None = None
    ) -> list[dict[str, Any]]:
        query = ""
        if params:
            query = "?" + "&".join(f"{k}={v}" for k, v in params.items() if v is not None)
        body_str = json.dumps(body) if body else ""
        request_path = f"{path}{query}"
        timestamp = self._timestamp()

        headers = {
            "OK-ACCESS-KEY": self._api_key,
            "OK-ACCESS-SIGN": self._sign(timestamp, method, request_path, body_str),
            "OK-ACCESS-TIMESTAMP": timestamp,
            "OK-ACCESS-PASSPHRASE": self._passphrase,
            "Content-Type": "application/json",
        }
        if self._is_demo:
            headers["x-simulated-trading"] = "1"

        try:
            async with httpx.AsyncClient(base_url=OKX_BASE_URL, timeout=10.0) as client:
                res = await client.request(method, request_path, headers=headers, content=body_str or None)
        except httpx.HTTPError as exc:
            raise ExchangeError(f"OKX request failed: {exc}") from exc

        payload = res.json()
        if payload.get("code") != "0":
            # OKX reports a rejected order twice: a generic top-level
            # code/msg ("1" / "Operation failed."), and the reason itself in
            # data[0].sCode/sMsg ("51016" / "Duplicated client order ID").
            # Prefer the specific one — the top-level pair names no cause, and
            # callers key on sCode to tell a duplicate apart from a real
            # rejection.
            data = payload.get("data") or []
            first = data[0] if data and isinstance(data[0], dict) else {}
            s_code = first.get("sCode")
            if s_code and s_code != "0":
                raise ExchangeError(first.get("sMsg") or payload.get("msg") or "OKX rejected the order", code=s_code)
            raise ExchangeError(payload.get("msg") or "OKX returned an error", code=payload.get("code"))
        return payload.get("data", [])

    async def get_balance(self) -> list[dict[str, Any]]:
        return await self._request("GET", "/api/v5/account/balance")

    async def get_positions(self, inst_type: str = "SWAP") -> list[dict[str, Any]]:
        return await self._request("GET", "/api/v5/account/positions", params={"instType": inst_type})

    async def get_open_orders(self, inst_type: str = "SWAP") -> list[dict[str, Any]]:
        return await self._request("GET", "/api/v5/trade/orders-pending", params={"instType": inst_type})

    async def place_order(
        self,
        *,
        inst_id: str,
        side: str,
        ord_type: str,
        size: str,
        price: str | None = None,
        td_mode: str = "cross",
        tp_trigger_px: str | None = None,
        sl_trigger_px: str | None = None,
        cl_ord_id: str | None = None,
    ) -> list[dict[str, Any]]:
        body: dict[str, Any] = {
            "instId": inst_id,
            "tdMode": td_mode,
            "side": side,
            "ordType": ord_type,
            "sz": size,
        }
        if cl_ord_id is not None:
            body["clOrdId"] = cl_ord_id
        if price is not None:
            body["px"] = price
        attached = _attach_algo_ords(tp_trigger_px=tp_trigger_px, sl_trigger_px=sl_trigger_px)
        if attached is not None:
            body["attachAlgoOrds"] = [attached]
        return await self._request("POST", "/api/v5/trade/order", body=body)

    async def cancel_order(self, *, inst_id: str, order_id: str) -> list[dict[str, Any]]:
        return await self._request(
            "POST", "/api/v5/trade/cancel-order", body={"instId": inst_id, "ordId": order_id}
        )

    async def close_position(
        self, *, inst_id: str, pos_side: str = "net", td_mode: str = "cross", cl_ord_id: str | None = None
    ) -> list[dict[str, Any]]:
        """Fully closes an open position. For partial closes, place an opposite-side
        reduce-only market order via place_order instead — OKX's close-position
        endpoint only supports closing a position in full."""
        body: dict[str, Any] = {"instId": inst_id, "mgnMode": td_mode, "posSide": pos_side}
        if cl_ord_id is not None:
            body["clOrdId"] = cl_ord_id
        return await self._request("POST", "/api/v5/trade/close-position", body=body)

    async def place_reduce_only_order(
        self, *, inst_id: str, side: str, size: str, td_mode: str = "cross", cl_ord_id: str | None = None
    ) -> list[dict[str, Any]]:
        body: dict[str, Any] = {
            "instId": inst_id,
            "tdMode": td_mode,
            "side": side,
            "ordType": "market",
            "sz": size,
            "reduceOnly": True,
        }
        if cl_ord_id is not None:
            body["clOrdId"] = cl_ord_id
        return await self._request("POST", "/api/v5/trade/order", body=body)

    async def get_order_by_client_id(self, *, inst_id: str, cl_ord_id: str) -> dict[str, Any] | None:
        """Looks an order up by the id *we* minted for it, returning None when OKX
        has never seen it.

        This is what makes an interrupted placement answerable. A client-side
        timeout, a dropped connection, or a read timeout between us and OKX all
        leave the same question — did the order land? — and asking by `clOrdId`
        answers it without needing the `ordId` that never made it back. Order
        details cover filled orders too, so a market order that filled during
        the timeout is still found here.
        """
        try:
            data = await self._request(
                "GET", "/api/v5/trade/order", params={"instId": inst_id, "clOrdId": cl_ord_id}
            )
        except ExchangeError as exc:
            if exc.code == ORDER_DOES_NOT_EXIST:
                return None
            raise
        return data[0] if data else None

    async def get_fills_history(self, inst_type: str = "SWAP") -> list[dict[str, Any]]:
        return await self._request(
            "GET", "/api/v5/trade/fills-history", params={"instType": inst_type}
        )
