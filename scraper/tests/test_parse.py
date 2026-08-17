import pytest

from app.parse import FarsideParseError, ParsedFlowRow, parse_table

_HEADER = """
<thead>
<tr bgcolor="#eaeffa">
    <th><span class="tabletext">Date</span></th>
    <th><div align="right"><span class="tabletext">IBIT</span></div></th>
    <th><div align="right"><span class="tabletext">Total</span></div></th>
</tr>
</thead>
"""

_TRAILER = """
<tr style="background-color: #eaeffa !important;">
    <td><span class="tabletext">Total</span></td>
    <td><div align="right"><span class="tabletext">61,096</span></div></td>
    <td><div align="right"><span class="tabletext">51,857</span></div></td>
</tr>
"""


def _row(date_text: str, total_text: str) -> str:
    return f"""
    <tr>
        <td><span class="tabletext">{date_text}</span></td>
        <td><div align="right"><span class="tabletext">1.0</span></div></td>
        <td><div align="right"><span class="tabletext">{total_text}</span></div></td>
    </tr>
    """


def _page(*row_texts: str) -> str:
    # Mirrors Farside's real markup exactly, including the malformed stray
    # empty <tr> that precedes the first data row on the live page.
    rows = "\n".join(row_texts)
    return f"""
    <html><body>
    <table class="etf">
    {_HEADER}
    <tbody>
    <tr>
    {rows}
    {_TRAILER}
    </tbody>
    </table>
    </body></html>
    """


def test_positive_value():
    html = _page(_row("11 Jan 2024", "655.3"))
    rows = parse_table(html)
    assert rows == [ParsedFlowRow(flow_date=__import__("datetime").date(2024, 1, 11), total_net_flow=655.3)]


def test_negative_in_parentheses():
    html = _page(_row("12 Jan 2024", "(43.1)"))
    rows = parse_table(html)
    assert rows[0].total_net_flow == -43.1


def test_comma_thousands_separator_stripped():
    html = _page(_row("13 Jan 2024", "1,234.5"))
    rows = parse_table(html)
    assert rows[0].total_net_flow == 1234.5


def test_negative_with_comma_thousands():
    html = _page(_row("14 Jan 2024", "(1,113.7)"))
    rows = parse_table(html)
    assert rows[0].total_net_flow == -1113.7


def test_real_zero_is_kept_not_treated_as_missing():
    html = _page(_row("15 Jan 2024", "0.0"))
    rows = parse_table(html)
    assert len(rows) == 1
    assert rows[0].total_net_flow == 0.0


def test_blank_cell_is_skipped():
    html = _page(_row("16 Jan 2024", ""))
    rows = parse_table(html)
    assert rows == []


def test_dash_cell_is_skipped():
    html = _page(_row("17 Jan 2024", "-"))
    rows = parse_table(html)
    assert rows == []


def test_em_dash_cell_is_skipped():
    html = _page(_row("18 Jan 2024", "—"))
    rows = parse_table(html)
    assert rows == []


def test_nan_cell_is_skipped():
    html = _page(_row("19 Jan 2024", "NaN"))
    rows = parse_table(html)
    assert rows == []


def test_malformed_non_numeric_cell_is_skipped():
    html = _page(_row("20 Jan 2024", "tbd"))
    rows = parse_table(html)
    assert rows == []


def test_trailer_summary_rows_are_never_parsed_as_data():
    html = _page(_row("21 Jan 2024", "10.0"))
    rows = parse_table(html)
    # Only the one real data row — "Total"/"Average"/"Maximum"/"Minimum"
    # trailer rows (and the stray leading empty <tr>) must never appear.
    assert len(rows) == 1
    assert rows[0].flow_date.day == 21


def test_multiple_rows_parsed_in_order():
    html = _page(_row("22 Jan 2024", "5.0"), _row("23 Jan 2024", "(6.0)"))
    rows = parse_table(html)
    assert [r.total_net_flow for r in rows] == [5.0, -6.0]


def test_missing_table_raises_parse_error():
    with pytest.raises(FarsideParseError):
        parse_table("<html><body>no table here</body></html>")


def test_unexpected_header_raises_parse_error():
    html = """
    <table class="etf">
    <thead><tr><th>Something</th><th>Else</th></tr></thead>
    <tbody><tr><td>x</td><td>y</td></tr></tbody>
    </table>
    """
    with pytest.raises(FarsideParseError):
        parse_table(html)


def test_missing_tbody_raises_parse_error():
    html = f"""
    <table class="etf">
    {_HEADER}
    </table>
    """
    with pytest.raises(FarsideParseError):
        parse_table(html)
