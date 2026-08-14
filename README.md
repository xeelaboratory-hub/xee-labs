<div align="center">

# 📈 Xee.Labs

**An open-source trading terminal with a real live market-data backend — no signup, no API keys of your own to configure.**

Advanced charting · full drawing-tool suite · watchlist · depth-of-market · order panel · built-in paper-trading engine, fed by **real** live Binance and OKX perpetual futures data.

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
- [Refreshing the bundled demo data](#refreshing-the-bundled-demo-data)
- [Bring your own data / backend](#bring-your-own-data--backend)
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
**real market-data backend**. Open it and you land straight in a live-feeling
terminal: a candlestick chart with a full drawing toolbar, a watchlist, a
depth-of-market ladder, and an order ticket — all wired to an **in-browser
paper-trading engine**.

The backend (`backend/`, a standalone FastAPI + CryptoFeed service) streams
**live Binance and OKX perpetual futures data** — no exchange account or API
key required, since it only reads each exchange's public market data. The
frontend never talks to Binance/OKX directly; it talks to this backend over
REST (historical candles, symbols) and a WebSocket (live ticks and candle
updates), and the paper-trading engine fills and marks-to-market against
those real prices.

A backend-less **demo mode** also still exists (real historical OHLC bundled
at build time, replayed forward as a synthetic tick stream) and is used as
the frontend's fallback for anything the real backend doesn't cover yet
(accounts, orders/positions persistence, auth, journal, …) — see
[How it works](#how-it-works).

It's ideal as:

- A **self-hostable charting / paper-trading terminal** for real crypto
  perpetuals, with no third-party API keys to manage.
- A **reference UI** you can point at your own market-data and trading backend
  instead (the data layer is cleanly isolated — see [Bring your own data](#bring-your-own-data--backend)).
- A **learning sandbox** for charting, technical drawing, and order management.

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
- **Order panel**: market / limit / stop tickets with volume presets, take-profit
  and stop-loss, plus a one-click trade mode and an order confirmation dialog.
- **Positions / Orders / Trade History** tabs with modify, close, and close-all.

### 💵 Built-in paper trading
- Orders fill against an in-browser engine at the latest replayed price.
- Positions are **marked-to-market live** on every tick, with running P&L.
- Stop-loss / take-profit are evaluated automatically and close positions when hit.
- Account equity, balance, used/free margin update in real time.

### 🛰️ Real market data
- Live Binance and OKX perpetual futures (BTC, ETH on both exchanges) via the
  bundled `backend/` service — historical candles over REST, live ticks and
  candle updates over WebSocket.
- No API keys to configure — the backend only reads each exchange's public
  market data.
- A backend-less demo mode (real historical OHLC, replayed forward) is also
  available and used as a fallback for what the real backend doesn't cover.

## Quick start

The frontend talks to the real backend for market data, so both need to be
running. Two ways to do that:

### Option A — Docker (fastest)

> Requires **Docker** + **Docker Compose**.

```bash
docker compose up --build
```

Open `http://localhost:8080`. Nginx serves the built frontend and reverse-proxies
`/api` and `/ws` to the backend container — see [Running with Docker](#running-with-docker).

### Option B — local dev (hot reload)

> Requires **Node 20+** and **Python 3.11+**.

```bash
# Terminal 1 — backend
cd backend
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 3000

# Terminal 2 — frontend
npm install
npm run dev
```

Open the printed local URL (e.g. `http://localhost:5173`) — Vite proxies `/api`
and `/ws` to `localhost:3000`. The app boots straight into a funded paper-trading
account — pick a symbol from the watchlist, set a size in the order panel, and go
long or short. If the backend isn't running, market data requests will fail; there
is currently no automatic fallback to demo data when the frontend is pointed at a
live (non-demo) session.

To build for production:

```bash
npm run build      # outputs to dist/
npm run preview    # serve the production build locally (still needs the backend)
```

## How it works

Xee.Labs keeps the entire UI **backend-agnostic**. The terminal talks to two
service modules — a REST-shaped `api` and a streaming `wsClient` — and never cares
where the data comes from underneath. Today that's a mix of two sources:

```
                ┌─────────────────────────────────────────────┐
                │                Terminal UI                   │
                │  ChartPanel · OrderPanel · DOM · Watchlist    │
                └───────────────┬───────────────┬──────────────┘
                                │ api.*          │ wsClient.subscribe()
                ┌───────────────▼───────┐ ┌──────▼───────────────┐
                │   services/api.ts      │ │   services/ws.ts      │
                │  (REST-shaped facade)  │ │  (streaming client)   │
                └───┬───────────────┬───┘ └──────┬───────────────┘
                    │ market data   │ everything  │ real ticks/candles
                    │               │ else        │
        ┌───────────▼────────┐ ┌────▼────────────┐│
        │      backend/       │ │  services/demo/  │◄┘
        │  FastAPI + Crypto-   │ │  paper-trading    │
        │  Feed — REST + WS,    │ │  engine, chart     │
        │  live Binance/OKX      │ │  drawings, auth      │
        │  data                   │ │  stubs, accounts       │
        └────────────────────────┘ └───────────────────────┘
```

- **`backend/`** — a standalone FastAPI + CryptoFeed service. Serves symbols and
  historical candles over REST and streams live ticks + 1-minute candle updates
  over a WebSocket. This is the source of truth for **market data**: symbols,
  candles, and live prices.
- **`services/demo/engine.ts`** — the paper-trading engine and single source of
  truth for the account, positions, and orders. It's fed real prices from the
  backend's live ticks (via `services/ws.ts`), marks positions to market, and
  publishes the same position/order/equity events the UI already consumed. Order
  and account state is still local/ephemeral — there's no trading backend yet.
- **`services/demo/candles.ts` / `instruments.ts` / `data/`** — the backend-less
  fallback: real bundled historical OHLC, time-shifted to look live. Used for
  anything the real backend doesn't (yet) cover, and as an offline/local-dev mode.
- **`services/api.ts` / `services/ws.ts`** — the facade every UI component
  actually calls. `api.ts` routes market-data methods (`getSymbols`,
  `getCandles`, `getTick`, …) to the real backend and everything else to the demo
  layer; `ws.ts` is a real reconnecting WebSocket client that republishes backend
  events onto the same local event bus the paper-trading engine and UI already
  expect.

Because the data layer sits behind this stable interface, swapping what's behind
`api.ts`/`ws.ts` — backend-less demo → real market-data backend, as happened here
— never required changing a UI component. See
[docs/architecture/OVERVIEW.md](docs/architecture/OVERVIEW.md) for the full
breakdown.

## Project structure

```
src/
├─ App.tsx                  # boots a demo session, renders the terminal
├─ main.tsx                 # React entry, providers, MarketDataBridge
├─ pages/
│  ├─ TradingPage.tsx       # the full terminal layout
│  └─ trading/              # chart, order panel, DOM, watchlist, drawing tools…
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
│  ├─ api.ts                # REST-shaped facade (real backend + demo fallback)
│  ├─ ws.ts                 # streaming client (real reconnecting WebSocket)
│  ├─ store.tsx             # zustand stores (auth + trading state)
│  ├─ schemas.ts            # zod schemas / shared types
│  └─ demo/                 # paper-trading engine, bundled OHLC fallback
└─ styles/
scripts/
└─ fetch-demo-data.mjs      # refresh the bundled demo OHLC
backend/                    # FastAPI + CryptoFeed market-data service
├─ app/
│  ├─ main.py                # app assembly, CORS, feed supervisor startup
│  ├─ api/                   # market_data.py (REST), ws_gateway.py (WebSocket)
│  ├─ historical/            # per-exchange REST clients + timeframe mapping
│  ├─ feeds/                 # CryptoFeed wiring (Binance, OKX)
│  ├─ symbols.py             # symbol registry + trading metadata
│  ├─ store.py / bus.py      # in-memory latest-state cache + WS pub/sub
│  └─ schemas.py             # pydantic response/event models
├─ tests/
└─ Dockerfile
nginx.conf                  # frontend container's /api, /ws reverse proxy
docker-compose.yml          # frontend + backend, wired via nginx.conf
```

## Running with Docker

```bash
docker compose up --build
```

This builds and runs both services:

- **`backend`** — the FastAPI service, published on `:3000`.
- **`frontend`** — the production build served by nginx on `:8080`, which
  reverse-proxies `/api` and `/ws` to the `backend` service over the compose
  network (see [`nginx.conf`](nginx.conf)). The browser only ever talks to
  `:8080` — REST and WebSocket both go through the same origin, mirroring
  `vite.config.ts`'s dev proxy so no frontend code needs to know about the
  container topology.

Rebuild (`docker compose build`) whenever `Dockerfile`, `backend/Dockerfile`,
`backend/pyproject.toml`, `nginx.conf`, or `package*.json` changes — see
[AGENTS.md](AGENTS.md#local-dev-vs-docker) for the full local-dev-vs-Docker
guidance.

## Refreshing the bundled demo data

The demo OHLC lives in `src/services/demo/data/` as JSON and is fetched from the
public **Binance klines** endpoint (no API key required):

```bash
node scripts/fetch-demo-data.mjs
```

This re-pulls 1000 bars per symbol across every timeframe and rewrites the bundled
files. The data is genuine market history — Xee.Labs never ships synthetic candles.

## Bring your own data / backend

Xee.Labs ships with its own market-data backend (`backend/`), but the frontend
doesn't hard-depend on it — the UI only ever talks to two facade files, so
pointing it at a different backend (a different exchange, your own trading
backend, a paper-trading service, …) means implementing those two files against
your APIs — the rest of the app is untouched:

1. **`src/services/api.ts`** — the request/response methods the UI calls
   (`getSymbols`, `getCandles`, `placeOrder`, `getPositions`, `closePosition`, …).
   The expected shapes are defined in `src/services/schemas.ts`.
2. **`src/services/ws.ts`** — a client exposing
   `connect` / `subscribe(channel, handler)` / `subscribeAccounts` / `onStateChange`.
   Publish `MarketTick`, `CandleUpdate`, `Position*`, `Order*`, and `EquityUpdated`
   events on the `market-data` / `positions` / `orders` / `account` channels.

`src/components/MarketDataBridge.tsx` shows exactly which events the UI consumes.
See [docs/architecture/DATA-FLOW.md](docs/architecture/DATA-FLOW.md) for the full
contract the bundled `backend/` already implements.

## Adding instruments

Two separate symbol registries exist today — the bundled backend's (what the
live terminal actually uses) and the demo fallback's:

- **Real backend** — `backend/app/symbols.py` builds the registry from
  `SYMBOL_BASES` in `backend/app/config.py` (currently `BTC`, `ETH`) crossed
  with the supported exchanges. Add a base there, add its trading metadata to
  `_TRADING_META` in `symbols.py`, and add a display name to `_DISPLAY_NAMES`.
- **Demo fallback** — instruments are defined in `src/services/demo/instruments.ts`:
  1. Add a `Symbol` entry (name, tick size, contract size, etc.).
  2. Add its trading pair to the `SYMBOLS` map in `scripts/fetch-demo-data.mjs`.
  3. Run `node scripts/fetch-demo-data.mjs` to fetch and bundle its history.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the production build |
| `npm run typecheck` | Type-check the project with `tsc` |
| `npm run test` | Run the unit test suite (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `node scripts/fetch-demo-data.mjs` | Refresh bundled demo OHLC |
| `docker compose up --build` | Build and run frontend + backend together |
| `cd backend && uvicorn app.main:app --reload --port 3000` | Run the backend alone (hot reload) |
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
- **FastAPI** + **CryptoFeed** for the REST API and WebSocket gateway
- **httpx** for the per-exchange historical-candle REST clients
- **pytest** + **pytest-asyncio** for tests

## Known limitations

- **Paper-trading state is ephemeral** — positions, orders, and account balance
  reset on reload (chart drawings and templates persist via `localStorage`).
  This is true regardless of whether market data comes from the real backend or
  demo mode — there is no trading backend yet, only a market-data one.
- **The real backend has no persistence** — symbols, candles, and ticks are
  served from public exchange APIs and an in-memory cache; nothing is written to
  a database, and a restart loses all in-memory state (candles simply
  re-fetch from the exchange on the next request).
- **Crypto perpetuals only** — both the real backend (Binance/OKX BTC and ETH
  perpetual futures) and the demo fallback (Binance spot) are crypto-only out of
  the box. Wire your own adapter for FX, futures, or equities.
- **Demo mode's timeline is normalized** — its bundled history is shifted so the
  latest bar is "now." OHLC values are real; only the demo timestamps are
  remapped to feel live. The real backend has no such shift — its timestamps are
  genuine.
- The production `build` runs Vite only; run `npm run typecheck` separately for
  full type checking (currently fails with pre-existing errors inherited from
  this app's previous incarnation — see [AGENTS.md](AGENTS.md)).

## Contributing

Issues and pull requests are welcome. Good first contributions: new chart
indicators, additional drawing tools, a persistence layer for the paper account,
or data adapters for other exchanges/brokers.

## Acknowledgements

The chart engine and several plugins build on TradingView's open-source
[`lightweight-charts`](https://github.com/tradingview/lightweight-charts) library.

## License

See [LICENSE](LICENSE).
