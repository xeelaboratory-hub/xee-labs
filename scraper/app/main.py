"""Standalone process — not run inside the FastAPI container. Own service in
docker-compose.yml; for local dev, run `python -m app.main --once` manually
(no auto-loop wired into npm run dev / uvicorn --reload)."""
import argparse
import asyncio
import logging
import os

from app.fetch import fetch_farside_html
from app.parse import parse_table
from app.upsert import run_upsert

LOG = logging.getLogger("etf_scraper")

_INTERVAL_SECONDS = 30 * 60
_MAX_ATTEMPTS = 3
_RETRY_BACKOFF_SECONDS = 5


async def run_once() -> None:
    database_url = os.environ["DATABASE_URL"]
    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            html = fetch_farside_html()
            rows = parse_table(html)
            await run_upsert(rows, database_url)
            LOG.info("scrape run complete: %d rows processed", len(rows))
            return
        except Exception:
            LOG.exception("scrape attempt %d/%d failed", attempt, _MAX_ATTEMPTS)
            if attempt < _MAX_ATTEMPTS:
                await asyncio.sleep(_RETRY_BACKOFF_SECONDS * attempt)
    LOG.error("scrape run failed after %d attempts — next scheduled run will retry", _MAX_ATTEMPTS)


async def _loop() -> None:
    while True:
        await run_once()
        await asyncio.sleep(_INTERVAL_SECONDS)


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="run a single scrape and exit (manual local dev)")
    args = parser.parse_args()

    if args.once:
        asyncio.run(run_once())
    else:
        asyncio.run(_loop())


if __name__ == "__main__":
    main()
