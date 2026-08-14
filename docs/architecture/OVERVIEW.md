# Architecture Overview

> This describes how the codebase works as of the last edit to this file. File
> structure, line counts, and hook lists drift as the code changes — verify
> specific implementation details (line numbers, exact counts, whether a hook
> is actually called) against the live code before relying on them, rather
> than trusting this document at face value.

This is a **backend-less trading terminal**: a candlestick chart (drawing
tools, indicators, watchlist, DOM, order panel) wired to an **in-browser
paper-trading engine** seeded with real historical OHLC. There is no server
anywhere in this repo — understanding how the "backend" is faked is the key
to working in this codebase productively.

## The facade / demo-engine split

The UI never talks to `services/demo/*` directly. It talks to two facades:

- **`services/api.ts`** — `export const api = new Proxy(demoApi, { get })`.
  `demoApi` (`services/demo/api.ts`) implements the trading-relevant surface
  (orders, positions, candles, symbols, chart drawings). Any method the UI
  calls that `demoApi` doesn't implement resolves to a benign no-op returning
  `null` instead of throwing — **this is load-bearing, not a bug**: it lets
  `services/queries.ts` (a large set of TanStack Query hooks, inherited from
  this app's previous incarnation — see [PROJECT-CONTEXT.md](../PROJECT-CONTEXT.md))
  keep exporting hooks for features that don't exist in this build
  (leaderboards, competitions, AI-trader, bot integrations, MFA, push
  notifications, …) without crashing anything. Don't infer a working feature
  from a hook's existence in `queries.ts` — check whether `demoApi` actually
  implements the underlying method.
- **`services/ws.ts`** — `DemoWsClient`, exposing the same
  `connect`/`subscribe`/`subscribeAccounts`/`onStateChange` surface a real
  WebSocket client would. Internally it starts the tick feed and forwards to
  `services/demo/bus.ts`, a synchronous in-process pub/sub
  (`Map<channel, Set<handler>>`) shaped exactly like a WS channel contract.

To point this app at a real backend: reimplement `services/api.ts` and
`services/ws.ts` against your own API, keeping the shapes in
`services/schemas.ts` (Zod). No other file needs to change —
`src/components/MarketDataBridge.tsx` is the one place that documents exactly
which events (`MarketTick`, `CandleUpdate`, `Position*`, `Order*`,
`EquityUpdated`) the UI consumes off the `market-data`/`positions`/`orders`/
`account` channels. See also
[decisions/0003-protected-backend-integration-seams.md](../decisions/0003-protected-backend-integration-seams.md).

## The demo engine itself (`services/demo/`)

- **`engine.ts`** — single source of truth for the account/positions/orders,
  as module-scoped singletons (resets on page refresh by design).
  `placeOrder()` fills **instantly** at the latest tick price regardless of
  order type — LIMIT/STOP orders do not stay pending in this build, so
  `OrderModifyDialog` (edit a pending order) is effectively unreachable
  through normal use. `mark(symbol, price)` — called every tick — re-marks
  positions and auto-closes on SL/TP.
- **`candles.ts`** — bundles all of `services/demo/data/*.json` at build time
  via `import.meta.glob`, then serves them with every bar's timestamp shifted
  so the last real bar aligns to "now." OHLC values are always genuine; only
  the clock is synthetic.
- **`feed.ts`** — replays each symbol's real 1-minute closes as an infinite
  looping tick stream (600ms interval), driving both the live UI and
  `engine.mark()`.

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

## Data flow: WS event → UI (no network round trip)

`services/demo/bus.ts` publishes are synchronous.
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
- `services/api/*.ts` (a real, typed REST client — `request.ts`,
  `accounts.ts`, `auth.ts`, `market-data.ts`, `journal.ts`) is mostly dead
  weight in this demo build but is deliberately kept — see
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
- [decisions/](../decisions/) — why key parts of this architecture look the
  way they do, and what future agents should not casually reverse.
