# Architecture Overview

> This describes how the codebase works as of the last edit to this file. File
> structure, line counts, and hook lists drift as the code changes — verify
> specific implementation details (line numbers, exact counts, whether a hook
> is actually called) against the live code before relying on them, rather
> than trusting this document at face value.

This is a **trading terminal** — a candlestick chart (drawing tools,
indicators, watchlist, DOM, order panel) wired to an **in-browser
paper-trading engine** — paired with a **real market-data backend**
(`backend/`). Understanding the facade/backend split below is the key to
working in this codebase productively: market data is real and networked,
trading/accounts/auth are still an in-browser demo layer.

## The facade / backend split

The UI never talks to `services/demo/*` or `backend/` directly. It talks to
two facades:

- **`services/api.ts`** — a `Proxy` over `demoApi`
  (`services/demo/api.ts`, which implements orders, positions, chart
  drawings, and other trading-relevant surface) with four market-data
  methods (`getSymbols`, `getTick`, `getCandles`, `getCandlesWithMeta`)
  overridden ahead of it to call `marketdataApi`
  (`services/api/market-data.ts`), a real typed HTTP client hitting
  `backend/`. Any method neither the overrides nor `demoApi` implement
  resolves to a benign no-op returning `null` instead of throwing — **this
  is load-bearing, not a bug**: it lets `services/queries.ts` (a large set
  of TanStack Query hooks, inherited from this app's previous incarnation —
  see [PROJECT-CONTEXT.md](../PROJECT-CONTEXT.md)) keep exporting hooks for
  features that don't exist in this build (leaderboards, competitions,
  AI-trader, bot integrations, MFA, push notifications, …) without crashing
  anything. Don't infer a working feature from a hook's existence in
  `queries.ts` — check whether `demoApi`/the real overrides actually
  implement the underlying method.
- **`services/ws.ts`** — a real reconnecting `WebSocket` client
  (`RealWsClient`) connecting to `backend/`'s `/ws` gateway, exposing the
  same `connect`/`subscribe`/`subscribeAccounts`/`onStateChange` surface the
  old demo client did. It always subscribes to the backend's full symbol
  universe on connect (the backend has no per-symbol resubscribe), republishes
  every `MarketTick`/`CandleUpdate`/`CandleClosed` frame onto
  `services/demo/bus.ts` (the same synchronous in-process pub/sub the demo
  layer still uses for `account`/`positions`/`orders` events), and calls
  `services/demo/engine.ts`'s `mark(symbol, price)` directly on each tick so
  the paper-trading engine marks-to-market against real prices.

`src/components/MarketDataBridge.tsx` is the one place that documents exactly
which events (`MarketTick`, `CandleUpdate`, `Position*`, `Order*`,
`EquityUpdated`) the UI consumes off the `market-data`/`positions`/`orders`/
`account` channels — this didn't need to change when the market-data side of
`api.ts`/`ws.ts` was pointed at the real backend. See also
[decisions/0003-protected-backend-integration-seams.md](../decisions/0003-protected-backend-integration-seams.md).

## The real backend (`backend/`)

A standalone FastAPI + CryptoFeed service, unrelated to the Node/Vite
frontend build. Serves live Binance and OKX perpetual futures (BTC, ETH on
both exchanges — symbol ids are exchange-qualified, e.g. `BINANCE:BTCUSD`,
never merged across exchanges).

- **`app/symbols.py`** — the symbol registry (cross product of exchanges ×
  `SYMBOL_BASES`) plus a static trading-metadata table (`_TRADING_META`:
  tick size, contract size, leverage, …) the paper-trading engine needs.
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
  changing symbol interest requires a new connection (see
  [DATA-FLOW.md](DATA-FLOW.md)).
- **`app/store.py` / `app/bus.py`** — in-memory latest-tick/candle/health
  cache and a per-connection `asyncio.Queue` pub/sub. No persistence — a
  restart loses all in-memory state; candles simply re-fetch from the
  exchange on the next request.

**Docker topology**: `docker-compose.yml` runs `backend` (published on
`:3000`) and `frontend` (nginx on `:8080`) together. `nginx.conf` reverse-
proxies `/api` and `/ws` from the frontend container to `backend:3000` over
the compose network, so the browser only ever talks to one origin — the same
same-origin shape `vite.config.ts`'s dev proxy gives local dev. See
[../../README.md](../../README.md#running-with-docker).

## The demo engine and fallback layer (`services/demo/`)

Still the source of truth for everything the real backend doesn't cover
(accounts, orders/positions, chart drawings, …), and the offline/local-dev
fallback for market data.

- **`engine.ts`** — single source of truth for the account/positions/orders,
  as module-scoped singletons (resets on page refresh by design).
  `placeOrder()` fills **instantly** at the latest tick price regardless of
  order type — LIMIT/STOP orders do not stay pending in this build, so
  `OrderModifyDialog` (edit a pending order) is effectively unreachable
  through normal use. `mark(symbol, price)` — called on every real tick from
  `services/ws.ts` — re-marks positions and auto-closes on SL/TP.
  `setSymbolMeta(symbols)` (called once from `store.tsx`'s `loadSymbols()`
  after the real `getSymbols()` resolves) populates the contract-size lookup
  the margin/PnL math uses, keyed by the real backend's exchange-qualified
  symbol ids — this replaced an earlier lookup against the demo
  `instruments.ts` table, which used bare names (`"BTCUSD"`) that no longer
  match live symbol ids (`"BINANCE:BTCUSD"`).
- **`candles.ts`** — bundles all of `services/demo/data/*.json` at build time
  via `import.meta.glob`, then serves them with every bar's timestamp shifted
  so the last real bar aligns to "now." OHLC values are always genuine; only
  the clock is synthetic. Only reached today via `services/api.ts`'s fallback
  to `demoApi` — the real backend serves candles primarily.
- **`feed.ts`** — replays each symbol's real 1-minute closes as an infinite
  looping tick stream (600ms interval). **Currently unimported/dead** —
  `services/ws.ts` calls `engine.mark()` directly from real backend ticks
  instead. Left on disk pending the Phase 4 demo-removal cleanup (see
  [PROJECT-CONTEXT.md](../PROJECT-CONTEXT.md)).

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
real network WebSocket from `backend/` before `services/ws.ts` republishes
them onto `services/demo/bus.ts`; `account`/`positions`/`orders` events still
originate locally from `services/demo/engine.ts` with no network round trip
at all. From `bus.ts` onward, publishes are synchronous either way.
`src/components/MarketDataBridge.tsx` — mounted once, deliberately **above**
`ErrorBoundary` in `main.tsx` so a crashing route can't kill the tick handler
— is the only subscriber that matters: it patches the TanStack Query cache
directly (`queryClient.setQueryData`) rather than triggering a refetch,
batching bursts of position-open events over 50ms. Mutation hooks'
`onSuccess` invalidations (`services/queries.ts`) are a secondary
consistency net on top of this, not the primary update path.

> A deeper, step-by-step trace of this data flow is being prepared
> separately and is not yet part of this doc set.

## State

- **Zustand** (`services/store.tsx`): `useAuthStore` (tokens/user,
  self-rescheduling token refresh loop) and `useTradingStore`
  (accounts/positions/orders, RAF-batched tick cache, replay state machine).
- **TanStack Query** (`services/queries.ts`) for everything server-shaped,
  seeded/patched by the WS bridge above.
- Chart drawings, chart templates, and chart preferences persist directly to
  `localStorage` (`useChartDrawings`, `chartTemplatesApi`,
  `useChartPreferences`) — no backend involved even in concept.

## Known issues / gotchas

- `npm run typecheck` currently fails with pre-existing errors, mostly in
  `services/queries.ts` and `services/store.tsx` — leftovers from the app's
  prior incarnation, not something recent edits are expected to fix
  incidentally.
- `npm run lint` has no config to run against.
- Replay session playback (`ReplayHUD`, `ReplayScrubber`,
  `useReplayChartData`/`Playback`) is gated off via `REPLAY_ENABLED = false`
  in `pages/trading/constants.ts`, and its transport (`accountsApi.replay*`
  in `services/api/accounts.ts`) calls real `/api/...` endpoints that don't
  exist in this build — bypassing the demo facade entirely, wrapped in
  `.catch(() => null)`.
- `services/api/*.ts` is a real, typed REST client (`request.ts`,
  `accounts.ts`, `auth.ts`, `market-data.ts`, `journal.ts`). `request.ts` and
  `market-data.ts` are now live and load-bearing — `services/api.ts`'s
  market-data overrides call `market-data.ts`'s `marketdataApi`, built on
  `request.ts`. `accounts.ts` is partially live (chart templates). `auth.ts`
  and `journal.ts` are still unused but deliberately kept — see
  [decisions/0003-protected-backend-integration-seams.md](../decisions/0003-protected-backend-integration-seams.md).
- `src/pages/AiTraderPage.tsx` is two stub components that return `null`;
  the AI-trader feature is not part of this product.
- [`docs/components/COMPONENTS.md`](../components/COMPONENTS.md) catalogs
  every UI component with screenshots and flags which ones are
  unreachable/dead code in the current build — check there before assuming a
  component in `src/components/` or `src/pages/trading/` is actually wired
  up.

## See also

- [PROJECT-CONTEXT.md](../PROJECT-CONTEXT.md) — what this project is, its
  provenance, current goals, and known limitations.
- [DATA-FLOW.md](DATA-FLOW.md) — detailed data-path and backend-contract map;
  complements this file's architecture-level overview.
- [decisions/](../decisions/) — why key parts of this architecture look the
  way they do, and what future agents should not casually reverse.
