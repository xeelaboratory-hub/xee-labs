"""Parse Farside's BTC ETF flow table. Only the `Date` and `Total` columns
are used — we never pull individual funds and never compute the total
ourselves; Farside's own Total column is the source of truth.
"""
from dataclasses import dataclass
from datetime import date, datetime

from bs4 import BeautifulSoup

_BLANK_VALUES = {"", "-", "–", "—", "n/a", "nan"}


class FarsideParseError(Exception):
    """Farside's table structure doesn't match what we expect — abort the
    run rather than risk inserting garbage."""


@dataclass(frozen=True)
class ParsedFlowRow:
    flow_date: date
    total_net_flow: float


def parse_table(html: str) -> list[ParsedFlowRow]:
    # lxml (not the stdlib html.parser) is required here: Farside's HTML has
    # a malformed stray empty `<tr>` before the first data row, and
    # html.parser doesn't implement HTML5's implicit-close-on-nested-<tr>
    # rule, so it nests the entire rest of the table inside that empty row
    # and silently corrupts the first parsed row's last cell.
    soup = BeautifulSoup(html, "lxml")
    table = soup.find("table", class_="etf")
    if table is None:
        raise FarsideParseError('no <table class="etf"> found on the page')

    header = _header_texts(table)
    if not header or header[0] != "Date" or header[-1] != "Total":
        raise FarsideParseError(f"unexpected table header, expected first='Date' last='Total': {header!r}")

    body = table.find("tbody")
    if body is None:
        raise FarsideParseError("no <tbody> found in the etf table")

    rows: list[ParsedFlowRow] = []
    for tr in body.find_all("tr"):
        cells = tr.find_all("td")
        if not cells:
            continue

        flow_date = _parse_date(cells[0].get_text(strip=True))
        if flow_date is None:
            # Trailer summary rows ("Total"/"Average"/"Maximum"/"Minimum") or
            # stray spacer rows — not a data row, skip.
            continue

        value = _parse_value(cells[-1].get_text(strip=True))
        if value is None:
            # Blank / dash / NaN / malformed — never coerced to 0, never stored.
            continue

        rows.append(ParsedFlowRow(flow_date=flow_date, total_net_flow=value))

    return rows


def _header_texts(table) -> list[str]:
    thead = table.find("thead")
    if thead is None:
        return []
    header_row = thead.find("tr")
    if header_row is None:
        return []
    return [th.get_text(strip=True) for th in header_row.find_all("th")]


def _parse_date(text: str) -> date | None:
    text = text.strip()
    try:
        return datetime.strptime(text, "%d %b %Y").date()
    except ValueError:
        return None


def _parse_value(text: str) -> float | None:
    text = text.strip()
    if text.lower() in _BLANK_VALUES:
        return None

    negative = text.startswith("(") and text.endswith(")")
    if negative:
        text = text[1:-1]
    text = text.replace(",", "").strip()

    try:
        value = float(text)
    except ValueError:
        return None

    return -value if negative else value
