<div align="center">

# 📈 Xee.Labs

**A trading terminal with real market data and real order execution on OKX.**

Advanced charting · full drawing-tool suite · watchlist · depth-of-market ·
order panel · real accounts, positions, and orders on **OKX Demo Trading and
Live Trading**, fed by live Binance and OKX perpetual futures market data.

![Xee.Labs trading terminal](docs/screenshot.png)

</div>

---

## Table of contents

- [What is Xee.Labs?](#what-is-xeelabs)
- [Features](#features)
- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [Project structure](#project-structure)
- [Running with Docker](#running-with-docker)
- [Adding instruments](#adding-instruments)
- [Scripts](#scripts)
- [Tech stack](#tech-stack)
- [Known limitations](#known-limitations)
- [Contributing](#contributing)
- [Acknowledgements](#acknowledgements)
- [License](#license)

---

## What is Xee.Labs?

Xee.Labs is a professional-grade **trading terminal UI** paired with its own
backend (`backend/`, FastAPI) that owns auth, accounts, and order execution.
Register or log in, connect your OKX API credentials (Demo Trading or Live
Trading — your choice, switchable per session), and trade: every account
balance, position, order, and fill shown in the terminal is a real
round-trip to OKX's API. There is no mock data, no paper-trading engine, and
no silent fallback — a failed request shows as an error, never as fake data.

Market data (candles, live ticks) comes from a bundled backend service
(`backend/`, FastAPI + CryptoFeed) streaming **live Binance and OKX
perpetual futures data** — no exchange account needed just to see charts,
since that part only reads each exchange's public market data.

It's ideal as:

- A **self-hostable trading terminal** for OKX perpetual futures, if you
  want your own UI in front of your own OKX account(s).
- A **reference UI** you can point at your own market-data and trading
  backend instead (the data layer is cleanly isolated — see
  [Bring your own data](#bring-your-own-data--backend)).
- A **learning sandbox** for charting, technical drawing, and order
  management, using OKX's Demo Trading environment (simulated money, real
  exchange behavior).

## Features

### 📊 Charting
- Candlestick chart powered by [`lightweight-charts`](https://github.com/tradingview/lightweight-charts).
- Timeframes from **1m → 1w** (1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w).
- Volume histogram, OHLC legend, live bid/ask price lines, crosshair, and countdown.
- Session highlighting and session-break separators.
- Per-symbol chart preferences and saveable **chart templates** (persisted locally).

### ✏️ Drawing tools
- Draggable, hideable drawing toolbar with trend lines, rays, horizontal/vertical
  lines, rectangles, and text.
- Per-object styling (color, width, line style, labels) with a TradingView-style
  text settings editor.
- An **object tree** panel to select, toggle, and delete drawings.
- Drawings persist per symbol in `localStorage` and survive reloads.

### 📋 Watchlist · DOM · order panel
- **Watchlist** with live prices across all instruments.
- **Depth-of-market (DOM)** ladder.
- **Order panel**: market and limit tickets with volume presets, a one-click
  trade mode, and an order confirmation dialog. (STOP orders and
  take-profit/stop-loss are intentionally disabled — see
  [Known limitations](#known-limitations).)
- **Positions / Orders / Trade History** tabs with close and partial-close.

### 💵 Real accounts and real trading
- Register/log in (email + password, JWT session with a rotating, revocable
  refresh token).
- Connect OKX API credentials per user, encrypted at rest — separately for
  **Demo Trading** and **Live Trading**, switchable from the terminal.
- Every account balance, position, order, and trade-history entry is a live
  call to OKX. No mock data, no paper-trading engine.
- A failed exchange call (missing credentials, OKX rejection, network error)
  surfaces as a clear error message, never as silently-substituted fake data.

### 🛰️ Real market data
- Live Binance and OKX perpetual futures (BTC, ETH on both exchanges) via the
  bundled `backend/` service — historical candles over REST, live ticks and
  candle updates over WebSocket.
- No API keys needed just for charting — the market-data side only reads
  each exchange's public data.

## Quick start

The frontend needs the backend (for auth, market data, and trading) and a
Postgres database (for users and encrypted exchange credentials) running.
Two ways to get all of that:

### Option A — Docker (fastest)

> Requires **Docker** + **Docker Compose**.

```bash
cp .env.example .env
# fill in CREDENTIAL_ENCRYPTION_KEY and JWT_SECRET — see the generate
# commands in .env.example, or:
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
python3 -c "import secrets; print(secrets.token_urlsafe(48))"

docker compose up --build
```

Open `http://localhost:8080`. Nginx serves the built frontend and
reverse-proxies `/api` and `/ws` to the backend container; the backend
container runs database migrations automatically on startup, against its
own Postgres container — see [Running with Docker](#running-with-docker).

### Option B — local dev (hot reload)

> Requires **Node 20+**, **Python 3.11+**, and a running **Postgres** instance.

```bash
# Terminal 1 — backend
cd backend
pip install -e ".[dev]"
export DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/xee_labs
export CREDENTIAL_ENCRYPTION_KEY=...   # see .env.example
export JWT_SECRET=...                  # see .env.example
alembic upgrade head
uvicorn app.main:app --reload --port 3000

# Terminal 2 — frontend
npm install
npm run dev
```

Open the printed local URL (e.g. `http://localhost:5173`) — Vite proxies
`/api` and `/ws` to `localhost:3000`. Register a user, then connect an OKX
API key (Demo Trading recommended to start) from the terminal's account
panel to see real positions/orders/balance and place real (simulated) trades.

To build for production:

```bash
npm run build      # outputs to dist/
npm run preview    # serve the production build locally (still needs the backend)
```

## How it works

Xee.Labs keeps the entire UI **backend-agnostic**. The terminal talks to two
service modules — a REST-shaped `api` and a streaming `wsClient` — and never
cares where the data comes from underneath. Both are backed entirely by the
bundled `backend/` service:

```
                ┌─────────────────────────────────────────────┐
                │                Terminal UI                   │
                │  ChartPanel · OrderPanel · DOM · Watchlist    │
                └───────────────┬───────────────┬──────────────┘
                                │ api.*          │ wsClient.subscribe()
                ┌───────────────▼───────┐ ┌──────▼───────────────┐
                │   services/api.ts      │ │   services/ws.ts      │
                │  (REST-shaped facade)  │ │  (streaming client)   │
                └───────────────┬────────┘ └──────┬───────────────┘
                                │                  │ live market-data ticks
                                v                  │ /candles only
                        ┌───────────────────────────────┐
                        │            backend/             │
                        │  FastAPI — auth (Postgres) +      │
                        │  OKX trading + CryptoFeed market    │
                        │  data (live Binance/OKX)              │
                        └───────────────────────────────────────┘
```

- **`backend/`** — a standalone FastAPI service. Owns three things: **auth**
  (Postgres-backed users, JWT sessions with rotating refresh tokens, and
  encrypted-at-rest OKX API credentials), **OKX trading** (real account
  balance, positions, open orders, place/cancel order, close position, trade
  history — against OKX's Demo Trading or Live Trading environment,
  selected per request), and **market data** (symbols + historical candles
  over REST, live ticks + 1-minute candle updates over WebSocket, for
  Binance and OKX perpetual futures).
- **`services/api.ts` / `services/ws.ts`** — the facade every UI component
  actually calls. `api.ts` routes every method to a real `backend/`
  endpoint; anything not implemented (dead PropSim-fork surface with zero UI
  consumers — leaderboards, AI-trader, etc.) throws a clear error instead of
  silently succeeding. `ws.ts` is a real reconnecting WebSocket client
  carrying market-data events only — positions/orders/account balance are
  kept fresh via REST polling instead (OKX's private WS channels aren't
  wired in yet).

Because the data layer sits behind this stable interface, pointing
`api.ts`/`ws.ts` at a different backend never requires changing a UI
component. See [docs/architecture/OVERVIEW.md](docs/architecture/OVERVIEW.md)
for the full breakdown.

## Project structure

```
src/
├─ App.tsx                  # gates on auth, renders LoginPage or the terminal
├─ main.tsx                 # React entry, providers, MarketDataBridge
├─ pages/
│  ├─ LoginPage.tsx         # email/password login + register
│  ├─ TradingPage.tsx       # the full terminal layout
│  └─ trading/              # chart, order panel, DOM, watchlist, AccountPanel
│                            # (mode switch + exchange-credential management)…
├─ lib/
│  ├─ chart-plugins/        # lightweight-charts plugins actually used by the chart
│  │  ├─ drawing-tools/      #   trend lines, rays, rectangles, text, object tree
│  │  ├─ delta-tooltip/ tooltip/ highlight-bar-crosshair/
│  │  └─ session-breaks/ session-highlighting/ bands-indicator/
│  ├─ indicators.ts         # indicator definitions
│  └─ utils.ts
├─ components/              # shared UI (order/position dialogs, ui primitives…)
├─ hooks/                   # chart drawings, preferences, indicators…
├─ services/
│  ├─ api.ts                # REST-shaped facade — real backend calls only
│  ├─ ws.ts                 # streaming client (market-data WebSocket)
│  ├─ eventBus.ts           # small in-process pub/sub ws.ts publishes onto
│  ├─ localDrawings.ts      # chart drawings — localStorage only
│  ├─ store.tsx             # zustand stores (auth + trading state)
│  └─ schemas.ts            # zod schemas / shared types
└─ styles/
backend/                    # FastAPI service — auth, OKX trading, market data
├─ app/
│  ├─ main.py                 # app assembly, CORS, feed supervisor startup
│  ├─ api/                    # market_data.py, trading.py, credentials.py, ws_gateway.py
│  ├─ auth/                   # router.py, security.py (JWT + bcrypt), deps.py
│  ├─ db/                      # SQLAlchemy models (User, RefreshToken, ExchangeCredential)
│  ├─ exchange/                 # okx_client.py (signed REST calls), mapping.py
│  ├─ security/                  # Fernet credential encryption
│  ├─ historical/                 # per-exchange REST clients + timeframe mapping
│  ├─ feeds/                       # CryptoFeed wiring (Binance, OKX)
│  ├─ symbols.py                    # symbol registry + native<->our-id mapping
│  ├─ store.py / bus.py              # in-memory latest-state cache + WS pub/sub
│  └─ schemas.py                      # pydantic response/event models
├─ alembic/                    # DB migrations
├─ tests/
└─ Dockerfile
nginx.conf                  # frontend container's /api, /ws reverse proxy
docker-compose.yml          # frontend + backend + postgres + etf-scraper
```

## Running with Docker

```bash
cp .env.example .env   # fill in CREDENTIAL_ENCRYPTION_KEY, JWT_SECRET, and POSTGRES_PASSWORD
docker compose up --build
```

This builds and runs four services:

- **`postgres`** — internal to the compose network only, not published to
  the host.
- **`backend`** — the FastAPI service, published on `:3000`. Its entrypoint
  (`backend/docker-entrypoint.sh`) runs `alembic upgrade head` before
  starting uvicorn, so a fresh `docker compose up --build` against an empty
  Postgres works with no manual migration step.
- **`frontend`** — the production build served by nginx on `:8080`, which
  reverse-proxies `/api` and `/ws` to the `backend` service over the compose
  network (see [`nginx.conf`](nginx.conf)). The browser only ever talks to
  `:8080` — REST and WebSocket both go through the same origin, mirroring
  `vite.config.ts`'s dev proxy so no frontend code needs to know about the
  container topology.
- **`etf-scraper`** — no published port; keeps the `etf_flows` table current
  against the same Postgres (see `scraper/`).

Rebuild (`docker compose build`) whenever `Dockerfile`, `backend/Dockerfile`,
`backend/pyproject.toml`, `backend/alembic/versions/` (new migration),
`nginx.conf`, or `package*.json` changes — see
[AGENTS.md](AGENTS.md#local-dev-vs-docker) for the full local-dev-vs-Docker
guidance.

## Bring your own data / backend

Xee.Labs ships with its own backend (`backend/`), but the frontend doesn't
hard-depend on it — the UI only ever talks to two facade files, so pointing
it at a different backend (a different exchange, your own trading backend,
a paper-trading service, …) means implementing those two files against your
APIs — the rest of the app is untouched:

1. **`src/services/api.ts`** — the request/response methods the UI calls
   (`login`, `getSymbols`, `getCandles`, `placeOrder`, `getPositions`,
   `closePosition`, …). The expected shapes are defined in
   `src/services/schemas.ts`.
2. **`src/services/ws.ts`** — a client exposing
   `connect` / `subscribe(channel, handler)` / `onStateChange`. Publish
   `MarketTick`, `CandleUpdate`, and `CandleClosed` events on the
   `market-data` channel.

`src/components/MarketDataBridge.tsx` shows exactly which events the UI
consumes. See [docs/architecture/DATA-FLOW.md](docs/architecture/DATA-FLOW.md)
for the full contract the bundled `backend/` already implements.

## Adding instruments

Instruments are defined in `backend/app/symbols.py`, built as the cross
product of `SYMBOL_BASES` (`backend/app/config.py`, currently `BTC`, `ETH`)
and the supported exchanges (Binance, OKX). To add one:

1. Add the base to `SYMBOL_BASES` in `backend/app/config.py`.
2. Add its trading metadata to `_TRADING_META` in `backend/app/symbols.py`.
3. Add a display name to `_DISPLAY_NAMES` in `backend/app/symbols.py`.

`_build_registry()` derives both the CryptoFeed-normalized symbol (for the
live feed) and each exchange's native REST symbol (for historical candles
and OKX trading calls) automatically from the base + exchange.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the production build |
| `npm run typecheck` | Type-check the project with `tsc` |
| `npm run test` | Run the unit test suite (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `docker compose up --build` | Build and run frontend + backend + postgres together |
| `cd backend && uvicorn app.main:app --reload --port 3000` | Run the backend alone (hot reload) |
| `cd backend && alembic upgrade head` | Apply database migrations |
| `cd backend && pytest` | Run the backend test suite |

## Tech stack

**Frontend**
- **React 19** + **TypeScript** + **Vite 6**
- **lightweight-charts** (+ custom plugins) for the chart engine
- **Zustand** for state, **TanStack Query** for data caching
- **Tailwind CSS** + **Radix UI** primitives
- **Zod** for schema validation
- **Vitest** + **Testing Library** for tests

**Backend** (`backend/`)
- **FastAPI** for the REST API and WebSocket gateway
- **CryptoFeed** for live Binance/OKX market-data streaming
- **SQLAlchemy** + **Alembic** + **Postgres** for users, sessions, and
  encrypted exchange credentials
- **httpx** for the per-exchange historical-candle and OKX trading REST clients
- **bcrypt** + **PyJWT** for auth; **cryptography** (Fernet) for
  credential encryption at rest
- **pytest** + **pytest-asyncio** for tests

## Known limitations

- **STOP orders and take-profit/stop-loss are not wired up.** OKX
  conditional/algo orders are a distinct integration from plain market/limit
  orders — the UI disables these controls with an explanation rather than
  silently accepting and dropping them. Same for amending a pending order —
  cancel and re-place instead.
- **No real-time push for positions/orders/account balance.** The backend's
  WebSocket only streams market data; positions/orders/account are kept
  fresh via REST polling (30s / 15s) plus an immediate refetch after your
  own trading actions.
- **Trade history is a flat fills log**, not paired entry/exit records — OKX
  doesn't expose position-lifecycle pairing directly.
- **Crypto perpetuals only** — Binance/OKX BTC and ETH perpetual futures out
  of the box. Wire your own adapter for FX, other assets, or exchanges.
- The production `build` runs Vite only; run `npm run typecheck` separately
  for full type checking (currently fails with pre-existing errors confined
  to two files with zero UI consumers for the affected code — see
  [AGENTS.md](AGENTS.md)).

## Contributing

Issues and pull requests are welcome. Good first contributions: new chart
indicators, additional drawing tools, OKX conditional/algo order support
(STOP, TP/SL), or data adapters for other exchanges/brokers.

## Acknowledgements

The chart engine and several plugins build on TradingView's open-source
[`lightweight-charts`](https://github.com/tradingview/lightweight-charts) library.

## License

See [LICENSE](LICENSE).
