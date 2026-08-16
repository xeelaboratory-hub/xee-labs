# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-08-16

### Added
- **Real accounts and real order execution on OKX**, replacing the
  in-browser paper-trading engine entirely. Register/log in (JWT session
  with a rotating, revocable refresh token), connect OKX API credentials
  per user (Fernet-encrypted at rest, separately for **Demo Trading** and
  **Live Trading**), and trade: account balance, positions, open orders,
  place/cancel order, close position, and trade history are all live calls
  to OKX. No mock data or silent fallback remains anywhere — a failed
  backend/exchange call now surfaces as a real error message.
- Backend gained Postgres + Alembic migrations (`users`, `refresh_tokens`,
  `exchange_credentials` tables) and a minimal OKX v5 REST client.
- New `LoginPage` (register/login) and `AccountPanel` (demo/live mode
  switch + connect-exchange dialog) — the app no longer auto-logs into an
  anonymous demo session on load.
- `docker-compose.yml` gained a `postgres` service; the backend image now
  runs database migrations automatically on container start.

### Removed
- `services/demo/*` (the paper-trading engine and its bundled OHLC
  fallback data), the session-replay feature, and the dead
  `services/api/{auth,journal,accounts}.ts` REST wrappers — all deleted
  outright, not renamed-and-kept.
- The `services/api.ts` silent-null fallback for unimplemented methods —
  replaced with a Proxy that throws a clear error instead.

### Changed
- `services/schemas.ts`'s `Account`/`Order`/`Position` shapes reshaped to
  match what OKX actually returns; dropped every PropSim-era field with no
  real-exchange equivalent.
- STOP orders, take-profit/stop-loss, and amending a pending order are
  intentionally disabled in the UI (OKX conditional/algo orders aren't
  wired up yet) rather than silently accepted and dropped.
- Positions/orders/account balance are now kept fresh via REST polling
  (30s/15s) plus a refetch after each trading mutation, not a WebSocket
  push — the backend's `/ws` gateway only streams market data.

## [1.1.0] - 2026-08-14

### Added
- Real market data: the terminal now runs on live Binance and OKX perpetual
  futures data (BTC and ETH, both exchanges) via a new standalone FastAPI +
  CryptoFeed backend (`backend/`), replacing the in-process demo/mock engine
  for symbols, historical candles, and live ticks. Symbol ids are now
  exchange-qualified (e.g. `BINANCE:BTCUSD`, `OKX:BTCUSD`); all 8 chart
  timeframes (1m–1w) are served over REST, and a reconnecting WebSocket
  delivers live ticks and 1-minute candle updates. Paper trading is
  unchanged in mechanics — orders now fill and mark-to-market against real
  prices instead of replayed demo data.
- The demo/mock data engine remains on disk, unused, as a temporary
  fallback during the migration; full removal is planned as a follow-up.

## [1.0.14] - 2026-08-14

### Fixed
- Drawing-tool canvas labels (Ruler/Measure stat box, angle label, Fib
  retracement levels, Text tool) now use the app-wide TradingView font
  stack instead of generic browser `monospace`/`sans-serif` — canvas
  text isn't reachable by CSS/Tailwind, so these were missed by
  v1.0.8's font switch.

## [1.0.13] - 2026-08-14

### Removed
- Leftover "Bid line" / "Ask line" toggles (Chart Settings → Trading)
  and color pickers (Chart Settings → Colors), plus all underlying
  preference/theme plumbing — a stale option for the display
  convention v1.0.12 replaced with a single current price. The chart's
  price-scale line now unconditionally shows the current/mid price.

## [1.0.12] - 2026-08-14

### Changed
- Toolbar and chart price-scale line now show a single current (mid)
  price instead of separate Bid/Ask values — the TradingView/Binance-
  style single-ticker convention, chosen over the MT4-style broker
  convention. Toolbar badge was replaced outright (no toggle existed);
  the chart price-scale line reuses its existing `showBidLine`/
  `showAskLine` toggles and built-in mid-price fallback, now on by
  default. Still toggleable via Chart Settings → Trading.

## [1.0.11] - 2026-08-14

### Removed
- Symbol/timeframe label and the secondary Bid/Ask/Spread row from the
  chart's top-left corner overlay. Neither was gated by a preference
  (unlike the OHLC legend and countdown rows in the same overlay, which
  keep their existing Chart Settings toggles) — removed outright with
  no new toggle added.

## [1.0.10] - 2026-08-14

### Changed
- OHLC legend box (symbol/O/H/L/C/Bid/Ask/Spread) in the chart's
  top-left corner is now off by default (was on). Still toggleable via
  Chart Settings → Appearance → "OHLC Legend".

## [1.0.9] - 2026-08-14

### Changed
- Volume histogram at the bottom of the chart is now off by default (was
  on). Still toggleable via Chart Settings → Appearance → "Volume".

## [1.0.8] - 2026-08-14

### Changed
- Terminal typography now matches TradingView's own font stack instead
  of a dedicated self-hosted mono/sans pair. Body text, the chart's own
  labels, and every numeric value (price, P&L, quantities) render in the
  same system font stack (`-apple-system, BlinkMacSystemFont,
  "Trebuchet MS", Roboto, Ubuntu, sans-serif`) that tradingview.com
  itself uses, verified live against the site. Removed the
  `@fontsource-variable/inter` and `@fontsource-variable/jetbrains-mono`
  self-hosted fonts.

## [1.0.7] - 2026-08-14

### Added
- `docs/components/COMPONENTS.md` — a full UI component reference (~58
  components) with live screenshots captured from the running dev
  server, organized by area. Components unreachable in the current
  build (feature-flagged, hidden pending QA, or dead code) are called
  out explicitly.

## [1.0.6] - 2026-08-14

### Changed
- Removed the TradingView attribution logo from the main chart
  (`layout.attributionLogo: false`). A "Charts by TradingView" link
  now appears in the Footer instead, satisfying the lightweight-charts
  license's linking requirement.

## [1.0.5] - 2026-08-14

### Changed
- Symbol watermark on the main chart is now off by default (was on).
  Still toggleable via Chart Settings → Appearance → "Symbol watermark".

## [1.0.4] - 2026-08-14

### Added
- `CHANGELOG.md` documenting the project's release history.

## [1.0.3] - 2026-08-14

### Changed
- Rebranded remaining `OpenCharts` references to `Xee.Labs` across
  `public/manifest.json` (PWA name/short_name), the loading screen text and
  doc comments in `App.tsx`, `services/api.ts`, `services/ws.ts`,
  `pages/AiTraderPage.tsx`, `vendor/types.ts`, `scripts/fetch-demo-data.mjs`,
  and `README.md`.

## [1.0.2] - 2026-08-14

### Changed
- Rebranded `index.html` (title, meta tags) from `OpenCharts` to `Xee.Labs`.
- The browser tab title now reads "Xee.Labs DEV MODE" when running under
  the Vite dev server, distinguishing it from the production build title.

## [1.0.1] - 2026-08-14

### Fixed
- Footer version badge now reads from `package.json` instead of a
  hardcoded string, so it stays in sync with the release version.

## [1.0.0] - 2026-08-14

### Added
- Initial stable release, tagged from the terminal-migration merge.
- Footer component displaying "Xee.Labs" branding with a version badge.
