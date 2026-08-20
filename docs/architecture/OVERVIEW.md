# Architecture Overview

> This describes how the codebase works as of the last edit to this file. File
> structure, line counts, and hook lists drift as the code changes — verify
> specific implementation details (line numbers, exact counts, whether a hook
> is actually called) against the live code before relying on them, rather
> than trusting this document at face value.

This is a **trading terminal** — a candlestick chart (drawing tools,
indicators, watchlist, DOM, order panel) wired to **real accounts and real
order execution on OKX** — paired with a **real market-data backend**
(`backend/`, also the same service that owns auth and trading). There is no
demo/mock layer anywhere in this codebase; understanding the
facade/backend split below is still the key to working here productively,
but both sides of that seam are real now.

## The facade / backend split

The UI never talks to `backend/` directly. It talks to two facades:

- **`services/api.ts`** — a plain object of real backend calls (auth,
  exchange credentials, market data, OKX trading), wrapped in a `Proxy`
  whose `get` trap returns the real method if implemented, or a function
  that **throws** a clear "not implemented" error otherwise. This replaced
  an earlier design (`demoApi` + a silent `null`-returning fallback) —
  `services/queries.ts` still exports dozens of TanStack Query hooks for
  PropSim-fork features with zero UI consumers (leaderboards, competitions,
  AI-trader, bot integrations, MFA, push notifications, trade journal, …);
  calling any of them now fails loudly instead of silently succeeding with
  fake data. Don't infer a working feature from a hook's existence in
  `queries.ts` — check whether `services/api.ts`'s `realImplementation`
  object actually implements the underlying method.
- **`services/ws.ts`** — a real reconnecting `WebSocket` client
  (`RealWsClient`) connecting to `backend/`'s `/ws` gateway. It always
  subscribes to the backend's full symbol universe on connect (the backend
  has no per-symbol resubscribe), and republishes every
  `MarketTick`/`CandleUpdate`/`CandleClosed` frame onto
  `services/eventBus.ts`, a small in-process pub/sub `MarketDataBridge`
  subscribes through. **Market data only** — positions/orders/account
  balance have no WS push; see "State" below for how those stay fresh.

`src/components/MarketDataBridge.tsx` documents exactly which market-data
events (`MarketTick`, `CandleUpdate`, `CandleClosed`) the UI consumes.

## The real backend (`backend/`)

A standalone FastAPI service (unrelated to the Node/Vite frontend build)
that owns three things: market data (CryptoFeed + per-exchange REST), auth
(Postgres-backed), and OKX trading.

**Market data:**

- **`app/symbols.py`** — the symbol registry (cross product of exchanges ×
  `SYMBOL_BASES`) plus a static trading-metadata table (`_TRADING_META`:
  tick size, contract size, leverage, …), and the bidirectional mapping
  between our symbol ids (`"OKX:BTCUSD"`) and each exchange's own native
  instrument id (`"BTC-USDT-SWAP"` for OKX) — `resolve_from_native()` is
  used by `app/exchange/mapping.py` to translate OKX responses back into our
  ids; `get_symbol(...).native_symbol` is used by `app/api/trading.py` to go
  the other way before calling OKX.
- **`app/historical/`** — per-exchange REST clients (`binance_klines.py`,
  `okx_candles.py`) plus a generic-timeframe → exchange-native-interval map
  (`config.TIMEFRAME_MAP`) so callers can request any of the 8 frontend
  timeframes without knowing Binance vs. OKX's differing interval
  vocabulary.
- **`app/feeds/`** — CryptoFeed wiring per exchange, supervised with capped/
  jittered reconnect backoff (`feeds/cryptofeed_runner.py`). `feeds/okx.py`
  subclasses CryptoFeed's `OKX` feed to route the `CANDLES` channel to
  `/ws/v5/business` — CryptoFeed 2.5.0 hardcodes the `/ws/v5/public`
  endpoint, which OKX rejects for candle subscriptions.
- **`app/api/market_data.py`** — REST routes (`/symbols`, `/candles/{symbol}`,
  `/ticks`, `/ticks/{symbol}`, `/health`).
- **`app/api/ws_gateway.py`** — the `/ws` WebSocket gateway: negotiates a
  one-time subscribe frame, replays a warmup window of recent 1m candles,
  then streams live events. No resubscribe/unsubscribe support today —
  changing symbol interest requires a new connection. **Market data only** —
  does not carry account/position/order events.
- **`app/store.py` / `app/bus.py`** — in-memory latest-tick/candle/health
  cache and a per-connection `asyncio.Queue` pub/sub. No persistence for
  market data — a restart loses all in-memory state; candles simply
  re-fetch from the exchange on the next request.

**Auth (`app/auth/`, Postgres-backed):**

- **`app/db/models.py`** — `User`, `RefreshToken` (server-side, hashed,
  revocable/rotatable — not a bare stateless JWT refresh), and
  `ExchangeCredential` (per-user, per-exchange, Fernet-encrypted API
  credentials, never exposed back to the frontend once saved).
- **`app/auth/router.py`** — `/api/auth/{register,login,refresh,logout,me}`.
  Every refresh rotates the token (old one is marked revoked, a new one
  issued) — reusing a stale refresh token fails immediately, which also
  makes token theft detectable (the replacement chain breaks).
- **`app/auth/security.py`** — `bcrypt` for password hashing (not
  `passlib` — `passlib`+`bcrypt` 5.x have a known incompatibility), `pyjwt`
  for access tokens.
- **`app/api/credentials.py`** — `/api/credentials` CRUD for a user's
  exchange API keys. Payloads are encrypted (`app/security/encryption.py`,
  Fernet, server-side `CREDENTIAL_ENCRYPTION_KEY`) before hitting Postgres;
  `GET` only ever returns metadata (id, exchange, `isDemo`, label,
  `createdAt`) — the encrypted secret itself never round-trips to the client.

**OKX trading (`app/exchange/`, `app/api/trading.py`):**

- **`app/exchange/okx_client.py`** — a minimal OKX v5 REST client: HMAC-SHA256
  request signing, balance/positions/open-orders/place-order/cancel-order/
  close-position/fills-history. `is_demo` toggles the `x-simulated-trading: 1`
  header, which routes the exact same signed request to OKX's Demo Trading
  environment instead of Live — same base URL, same credentials shape,
  different account behind it.
- **`app/exchange/mapping.py`** — normalizes raw OKX JSON into the frontend's
  Account/Position/Order/TradeHistoryEntry shapes, translating OKX's native
  instId back to our symbol id via `symbols.resolve_from_native()`.
- **`app/api/trading.py`** — `/api/account`, `/api/positions`, `/api/orders`
  (GET/POST), `/api/orders/{id}` (DELETE), `/api/positions/close`,
  `/api/trades/history` — every one takes a `mode=demo|live` query param,
  resolves the caller's encrypted credential for that (user, exchange, mode)
  triple, and calls OKX directly. **No fallback on failure** — a missing
  credential is a 404, an OKX rejection is a 502 with OKX's real error
  message forwarded through, never a silently-substituted empty/mock result.
  STOP orders and take-profit/stop-loss are intentionally not implemented
  here — see [PROJECT-CONTEXT.md](../PROJECT-CONTEXT.md)'s known limitations.

**Docker topology**: `docker-compose.yml` runs four services: `postgres`
(internal to the compose network only, not published to the host), `backend`
(published on `:3000` — its entrypoint runs `alembic upgrade head` before
starting uvicorn, so a fresh `docker compose up --build` against an empty
Postgres works with no manual migration step), `frontend` (nginx on
`:8080`), and `etf-scraper` (no published port — keeps `etf_flows` current
against the same Postgres). `nginx.conf` reverse-proxies `/api` and `/ws`
from the frontend container to `backend:3000` over the compose network, so
the browser only ever talks to one origin — the same same-origin shape
`vite.config.ts`'s dev proxy gives local dev. Note `backend` being published
directly on `:3000` (not just reachable via nginx) means it's a second,
un-proxied entry point — see `backend/app/auth/rate_limit.py`'s proxy-trust
handling for why that matters. See
[../../README.md](../../README.md#running-with-docker).

## Chart plugin architecture

(`src/pages/trading/ChartPanel.tsx`, `src/lib/chart-plugins/`)

`ChartPanel` creates the single `lightweight-charts` instance in an effect
keyed on `[isDark, pipDigits, colors, selectedSymbol]` — **not**
`timeframe`. The chart instance deliberately survives timeframe switches so
drawings and plugin state don't blink; a separate lightweight effect updates
time-scale options in place. A `chartEpoch` counter is used to re-bind
externally-managed DOM listeners (SL/TP drag, challenge levels) after the
chart is actually recreated.

Two distinct plugin styles coexist:

- **Primitive-based** overlays (`PluginBase` subclasses implementing
  `ISeriesPrimitive`, attached via `series.attachPrimitive()`) — drawing
  tools, session breaks/highlighting, tooltips, bands indicator. Cheap to
  toggle; canvas-rendered, no new chart series created.
- **Series-based** indicators (`src/lib/indicators.ts` +
  `pages/trading/useIndicators.ts`) — real `addLineSeries`/
  `addHistogramSeries` calls, torn down and rebuilt from scratch on every
  dependency change.

The drawing-tools subsystem (`src/lib/chart-plugins/drawing-tools/`) is a
hybrid: one `DrawingsPrimitive` renders every drawing in a single canvas
pass, driven by a separate non-primitive controller class,
`DrawingToolsManager` (`manager.ts`), which owns all pointer/keyboard event
handling, hit-testing, dragging, and persistence callbacks. `resolve.ts`
handles the hard coordinate cases — anchors drawn on a different timeframe,
or beyond loaded history — via logical-index interpolation/extrapolation
rather than `lightweight-charts`' native (integers-only)
`logicalToCoordinate`.

## Data flow: WS event → UI

Market-data events (`MarketTick`/`CandleUpdate`/`CandleClosed`) travel over a
real network WebSocket from `backend/`; `services/ws.ts` republishes them
onto `services/eventBus.ts` (a small in-process pub/sub — not tied to any
trading engine, just a channel dispatcher).
`src/components/MarketDataBridge.tsx` — mounted once, deliberately **above**
`ErrorBoundary` in `main.tsx` so a crashing route can't kill the tick handler
— subscribes to the `market-data` channel and patches Zustand/TanStack Query
state directly.

**Positions, orders, and account balance are NOT pushed over WS** — the
backend's `/ws` gateway only carries market data (OKX's private WS channels
for account/positions/orders aren't wired in). Instead:
`usePositions`/`useOrders`/`useAccount` (`services/queries.ts`) poll via
REST every 30s (positions/orders) or 15s (account), and every trading
mutation (`usePlaceOrder`, `useCancelOrder`, `useClosePosition`, …)
invalidates the relevant query in its `onSuccess` — so a state change caused
by the current user's own action reflects near-instantly, and everything
else (a fill, a liquidation, a manual close on OKX's own UI) shows up within
the poll interval.

## State

- **Zustand** (`services/store.tsx`): `useAuthStore` (tokens/user,
  self-rescheduling token refresh loop) and `useTradingStore` (selected
  symbol, `mode: "demo" | "live"` — which OKX environment trading actions
  target, RAF-batched tick cache, live candle updates).
- **TanStack Query** (`services/queries.ts`) for everything server-shaped:
  account, positions, orders, trade history, symbols, candles.
- Chart drawings persist directly to `localStorage`
  (`useChartDrawings`/`services/localDrawings.ts`) — no backend involved.
  Chart **preferences** (`useChartPreferences`) go through
  `services/preferences.ts`'s local cache too, but for logged-in users
  `App.tsx` syncs that cache with the backend (`GET`/`PUT /api/preferences`,
  a real `user_preferences` Postgres table, debounced 500ms on change) — it's
  not `localStorage`-only.

## Known issues / gotchas

- `npm run typecheck` currently fails with pre-existing errors confined to
  `src/services/queries.ts` and `src/hooks/useTraderPreferences.ts` — both
  are PropSim-fork leftovers with zero UI consumers for the affected code
  paths (verified), not something recent edits are expected to fix
  incidentally.
- `npm run lint` has no config to run against.
- STOP orders, take-profit/stop-loss, and amending a pending order are
  **intentionally disabled in the UI** (with an explanatory message, not
  silently dropped) — OKX conditional/algo orders aren't wired up yet. See
  `OrderPanel.tsx`, `MobileTradingPanel.tsx`, `OrderModifyDialog.tsx`,
  `PositionModifyDialog.tsx`.
- `src/pages/AiTraderPage.tsx` is two stub components that return `null`;
  the AI-trader feature is not part of this product.
- [`docs/components/COMPONENTS.md`](../components/COMPONENTS.md) catalogs
  every UI component with screenshots and flags which ones are
  unreachable/dead code in the current build — note it predates Phase 4 and
  may still reference removed demo-mode components; verify against live code.

## See also

- [PROJECT-CONTEXT.md](../PROJECT-CONTEXT.md) — what this project is, its
  provenance, current goals, and known limitations.
- [DATA-FLOW.md](DATA-FLOW.md) — detailed data-path and backend-contract map;
  complements this file's architecture-level overview.
- [decisions/](../decisions/) — why key parts of this architecture look the
  way they do, and what future agents should not casually reverse.
