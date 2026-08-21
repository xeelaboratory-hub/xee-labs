"""Unit tests for the attached TP/SL bracket built for OKX's `attachAlgoOrds`.

These sit below the API layer on purpose: `test_trading.py` proves the endpoint
forwards the right trigger prices, but the shape OKX actually receives — the
"-1" market sentinel and the pinned trigger reference — is decided here, and a
wrong value there fails silently as an un-triggerable protective order.
"""
import pytest

from app.exchange.okx_client import OKXClient, _attach_algo_ords


def test_no_bracket_yields_no_attachment():
    assert _attach_algo_ords(tp_trigger_px=None, sl_trigger_px=None) is None


def test_stop_loss_only_omits_the_take_profit_keys():
    attached = _attach_algo_ords(tp_trigger_px=None, sl_trigger_px="49000")
    assert attached == {
        "slTriggerPx": "49000",
        "slOrdPx": "-1",
        "slTriggerPxType": "last",
    }


def test_take_profit_only_omits_the_stop_loss_keys():
    attached = _attach_algo_ords(tp_trigger_px="52000", sl_trigger_px=None)
    assert attached == {
        "tpTriggerPx": "52000",
        "tpOrdPx": "-1",
        "tpTriggerPxType": "last",
    }


def test_both_legs_are_attached_together():
    attached = _attach_algo_ords(tp_trigger_px="52000", sl_trigger_px="49000")
    assert attached is not None
    assert attached["tpTriggerPx"] == "52000"
    assert attached["slTriggerPx"] == "49000"


@pytest.mark.parametrize("key", ["tpOrdPx", "slOrdPx"])
def test_triggered_legs_execute_at_market(key):
    """"-1" is OKX's sentinel for "market on trigger". A real price here would
    let the protective exit sit unfilled in exactly the move it exists for."""
    attached = _attach_algo_ords(tp_trigger_px="52000", sl_trigger_px="49000")
    assert attached[key] == "-1"


@pytest.mark.parametrize("key", ["tpTriggerPxType", "slTriggerPxType"])
def test_trigger_reference_is_pinned_to_last_price(key):
    """Not left to OKX's default: the chart and the Position Builder's stop
    model are both built on last price, so triggering off mark price would fire
    on a number the user never saw."""
    attached = _attach_algo_ords(tp_trigger_px="52000", sl_trigger_px="49000")
    assert attached[key] == "last"


# ── The body that actually goes on the wire ────────────────────────────────


class _RecordingClient(OKXClient):
    """A real OKXClient with only the transport replaced, so the body under
    test is the one `place_order` actually builds — not a re-implementation."""

    def __init__(self):
        super().__init__(api_key="k", api_secret="s", passphrase="p", is_demo=True)
        self.body = None

    async def _request(self, method, path, *, params=None, body=None):
        self.method, self.path, self.body = method, path, body
        return [{"ordId": "1", "sCode": "0"}]


@pytest.mark.asyncio
async def test_place_order_nests_the_bracket_in_a_list():
    """OKX takes `attachAlgoOrds` as an array, not a bare object — a dict here
    is rejected by the exchange, and nothing below this layer would catch it."""
    client = _RecordingClient()
    await client.place_order(
        inst_id="BTC-USDT-SWAP",
        side="buy",
        ord_type="limit",
        size="1",
        price="50000",
        tp_trigger_px="52000",
        sl_trigger_px="49000",
    )
    assert client.path == "/api/v5/trade/order"
    assert isinstance(client.body["attachAlgoOrds"], list)
    assert len(client.body["attachAlgoOrds"]) == 1
    assert client.body["attachAlgoOrds"][0]["slTriggerPx"] == "49000"


@pytest.mark.asyncio
async def test_place_order_omits_the_key_when_there_is_no_bracket():
    """An empty or absent bracket must leave `attachAlgoOrds` out of the body
    entirely — sending an empty array is not the same as sending nothing."""
    client = _RecordingClient()
    await client.place_order(inst_id="BTC-USDT-SWAP", side="buy", ord_type="market", size="1")
    assert "attachAlgoOrds" not in client.body
