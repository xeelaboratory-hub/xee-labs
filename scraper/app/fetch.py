"""Fetch Farside's full BTC ETF daily total net flow history.

Verified during implementation: plain `httpx` gets a Cloudflare "Just a
moment..." challenge (403) on farside.co.uk. `curl_cffi` with Chrome
impersonation gets a real 200 response, so it's used directly rather than
kept as a conditional fallback behind a library that never works here.

The "all data" page (not the front `/btc/` page, which only shows a recent
window) is used so a single fetch serves both the first-run full backfill
and every regular incremental run.
"""
from curl_cffi import requests

FARSIDE_ALL_DATA_URL = "https://farside.co.uk/bitcoin-etf-flow-all-data/"
_TIMEOUT_SECONDS = 20
_IMPERSONATE = "chrome124"


def fetch_farside_html() -> str:
    response = requests.get(FARSIDE_ALL_DATA_URL, timeout=_TIMEOUT_SECONDS, impersonate=_IMPERSONATE)
    response.raise_for_status()
    return response.text
