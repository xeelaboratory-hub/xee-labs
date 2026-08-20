# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.4] - 2026-08-21

### Added
- ESLint flat config (`eslint.config.js`) and the toolchain it needs
  (`eslint@9`, `typescript-eslint@8`, `eslint-plugin-react-hooks@5`,
  `eslint-plugin-react-refresh`, `globals`, `@eslint/js@9`). `npm run lint`
  had been defined as `eslint src/` all along, but ESLint was never a
  dependency and no config existed, so the script failed on a missing
  binary.

  The config is scoped to what `tsc` can't catch — React hook dependency
  arrays, Fast Refresh-unsafe exports, unreachable code — since
  `npm run typecheck` already owns type correctness and is clean repo-wide.
  typescript-eslint runs non-type-checked on purpose: the type-aware rules
  need a second full program build per run and would largely duplicate
  `typecheck`. `no-explicit-any` is set to `warn` as a ratchet — `src/`
  currently contains zero `any`.

  Baseline is 0 errors, 5 warnings across all 104 files in `src/` (4 hook
  dependency arrays, 1 Fast Refresh export). All 5 predate the config and
  were left untouched; fixing them changes runtime behavior and belongs in
  its own change.

### Changed
- `AGENTS.md` no longer documents `npm run lint` as unusable, and records
  the warning baseline so the count can't grow unnoticed.
- `package-lock.json` version fields are back in sync with `package.json`;
  they had drifted at 1.6.0 through the 1.6.1–1.6.3 releases.

## [1.6.3] - 2026-08-21

### Removed
- 67 dead PropSim-era hooks from `src/services/queries.ts` (741 lines) —
  leaderboards, competitions, certificates, support tickets, coupons, bot
  integrations, push notifications, profile/scaling/profit-split,
  account-merge, journal, payouts, analytics, announcements, and the
  AI-trader stubs. All had zero call sites and called methods that
  `services/api.ts` deliberately does not implement.
- The payout/journal/PnL response types and the firm-branding
  `localStorage` cache, orphaned by the above — the cache was read and
  written only by the deleted `useMyFirm`.

### Fixed
- `npm run typecheck` is clean repo-wide (was 117 errors, all in
  `queries.ts`). The dead hooks resolved through the `api` Proxy's
  `Record<string, (...args: never[]) => Promise<unknown>>` fallback, which
  under `noUncheckedIndexedAccess` yields `| undefined` (67× TS2722) and
  rejects every passed argument (42× TS2345). Removing the callers fixes
  this at the source instead of declaring a type for an API surface that
  does not exist.

The 14 hooks with real consumers are untouched, as are `useEconomicCalendar`,
`useModifyOrder`, and `useModifyPosition` — also unused, but they type-check.

## [1.6.2] - 2026-08-21

### Added
- Client-side validation of OKX API credentials in the Exchange Connections
  form (`src/lib/okx-credentials.ts`), catching mis-pastes before a broken
  credential is encrypted and stored. Blocking checks cover an empty or
  whitespace-only field, a secret identical to the key, and a UUID-shaped
  secret; the format checks that assert OKX's current shapes (UUID key,
  32-character hex secret) are warnings only, so a format change on OKX's
  side cannot lock a user out of saving a valid credential.

### Changed
- Credential fields are trimmed before submission — a pasted trailing
  newline was previously stored and counted by OKX as part of the value.

### Fixed
- A credential rejected by OKX previously surfaced only as a generic
  "Exchange error" in the status strip, naming no field and not
  distinguishing a mis-paste from a revoked key or an IP-whitelist block.
  The form now reports the specific problem as it is typed and disables
  the save button while a blocking problem remains.

## [1.6.1] - 2026-08-20

### Added
- Position Builder panel with a real OKX instrument-specs backend endpoint
  (`GET` instrument specs, `backend/app/exchange/okx_instruments.py`),
  letting a trade be sized against real contract specs before placing it.
- Full dark/light theming with 4 selectable accent colors (Teal/Blue/Violet/
  Amber) via `ThemeSwitcher` and `themeStore`, replacing hard-coded colors
  across `MobileTradingPanel`, `LoginPage`, `TradingPowerFeatures`, and
  `ChartPanel` with semantic tokens (`bg-buy`/`bg-sell`/`text-warning`/etc.).
- A typography scale (`text-label`/`text-meta`/`text-data`/`text-heading`)
  and a shared `PanelHeader` component, replacing 6 near-identical hand-rolled
  panel header implementations.

### Changed
- Unified buy/sell quick-trade buttons onto the shared `Button` component
  (new `xs` size) instead of hand-rolled markup.
- Normalized the corner-radius scale to two tiers (`rounded-md`/`rounded-lg`),
  removing stray `rounded-xl` usage across trading dialogs and the mobile
  panel.
- Unified the inconsistent close (`X`) icon sizing across panels and dialogs
  to two levels: 14px inline/panel, 16px dialog-level.

### Removed
- Dead legacy CSS classes (`.btn*`, `.panel*`, `.stat-*`, `.tab-*`, `.pnl-*`,
  `.mono`, `.text-muted`) from `src/styles/global.css`, verified unused
  across every `.tsx` file before deletion.

## [1.6.0] - 2026-08-20

Production-readiness and hardening pass ahead of the v1.0 launch — no new
user-facing features, focused on release blockers, security, data
integrity/recovery, observability, and code quality.

### Added
- PostgreSQL backup/restore tooling (`scripts/backup-postgres.sh`,
  `scripts/restore-postgres.sh`) using `pg_dump`/`pg_restore` against the
  docker-compose `postgres` service, with no credentials embedded in either
  script. Verified end-to-end against a real database: backup produced a
  valid archive, restore into a disposable database matched the live
  database's row counts across every table.
- A real `GET /api/health` endpoint — checks Postgres reachability
  (`SELECT 1`, returns 503 if unreachable) and reports current exchange feed
  connectivity. The Docker healthcheck now targets this instead of `/`,
  which returned 200 unconditionally regardless of whether the backend was
  actually usable.
- Server-side rate limiting on `POST /api/auth/login` (5 attempts/IP/60s
  **and** 8 attempts/account/60s) and `POST /api/auth/register` (3
  attempts/IP/60s) — in-memory sliding windows, since the backend runs as a
  single uvicorn worker. Over the limit returns `429` with `Retry-After`;
  the response never reveals whether the attempted email exists.
- Server-side validation: registration passwords require 8+ characters
  (matching the existing client-side rule); trading order `quantity`/`price`
  must be positive, finite numbers (rejecting non-positive values and
  NaN/Infinity, which standard JSON parsing accepts even though neither is
  valid JSON), and `LIMIT` orders require a `price`. Invalid requests never
  reach the OKX exchange client.
- Security headers on every response (`nginx.conf`): a Content-Security-Policy
  scoped to what the production build actually loads (verified against a
  real `npm run build`), `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, and `X-Frame-Options:
  DENY` alongside CSP's `frame-ancestors 'none'`.
- Sanitized operational logging: failed logins and rate-limit blocks (auth),
  and OKX `ExchangeError`s during order placement/close/cancel (trading) —
  never logs passwords, JWTs, refresh tokens, or exchange API secrets.
- Pinned dependency lockfiles (`backend/requirements-lock.txt`,
  `scraper/requirements-lock.txt`), used as `pip install --constraint` in
  both Dockerfiles so a Docker build resolves the same dependency versions
  every time instead of silently drifting.
- Test coverage for all of the above (backend and frontend), plus SonarQube
  Quality Gate integration (`sonar-project.properties`) verified passing
  (New Coverage, New Issues, New Duplication) across every change in this
  release.

### Changed
- `useAccount()` now polls every 15s (previously only refetched on mount),
  matching the existing 30s polling on positions/orders — the displayed
  balance could otherwise go silently stale between trades since there's no
  WebSocket push for it.
- The stale-market-data banner now reads the backend's actual
  `GET /api/market-data/health` response shape (`{binance: {connected,
  lastEventAt}, okx: {...}}`) instead of a field structure the backend never
  returned.
- `docker-compose.yml` no longer hardcodes the Postgres password — it's now
  a required `POSTGRES_PASSWORD` environment variable with no default;
  compose fails fast with a clear error if it's unset.
- Corrected stale project/deployment documentation: `ETF Flow`, `Session
  Volume Profile`, and `Large Order Book` were documented as scoped out and
  "not started" despite having shipped in v1.3.0–v1.5.0; the Docker
  deployment was documented as three services, missing `etf-scraper`; chart
  preferences were documented as `localStorage`-only despite being
  Postgres-backed for logged-in users since v1.3.1; the account polling
  interval was documented as a blanket 30s.

### Fixed
- The stale-data banner never actually worked — the frontend and backend
  disagreed on the market-data health response shape, so the warning
  condition could never be satisfied.
- Account balance could silently go out of date between trades, with
  nothing prompting a refresh.
- Watchlist category filters sorted with plain `Array.sort()` (UTF-16 code
  unit order), which could put an uppercase-led category before a
  lowercase-led one regardless of alphabetical order — now uses
  locale-aware comparison.
- Assorted static-analysis findings addressed as part of this release's
  code-quality pass: extracted nested ternary/conditional expressions in the
  Large Order Book and Session Volume Profile chart plugins and in
  `OrderPanel.tsx` into named helper functions, and associated form labels
  with their inputs (`MobileTradingPanel.tsx`) for accessibility.

### Security
- **Auth rate limiting and proxy-trust hardening**: login is limited both
  per-IP and per-account (see Added, above) so neither a single IP hammering
  many accounts nor many IPs hammering one account has an effectively
  unlimited attempt budget. Because `docker-compose.yml` publishes the
  backend's port directly to the host alongside nginx, `X-Forwarded-For` is
  only trusted when the request's actual TCP peer is a private-network
  address (i.e., proxied through nginx) — a direct hit can't forge its way
  past the IP limiter by setting an arbitrary header.
- **Security headers** (CSP, `X-Content-Type-Options`, `Referrer-Policy`,
  `X-Frame-Options`) — see Added, above.
- **Server-side password and trading input validation** — see Added, above.
  While implementing this, found and fixed a real information leak: FastAPI's
  default validation-error response echoed the raw password back in the
  `422` body (`{"input": "..."}`) — a global exception handler now redacts
  `input`/`ctx` for credential-shaped fields, and separately for any
  non-finite float value (which would otherwise crash the error response
  itself, since Starlette's `JSONResponse` rejects NaN/Infinity).
- **PostgreSQL credential handling** — the hardcoded `xee_labs:xee_labs`
  password is gone; see Changed, above.
- **Sanitized operational logging** — see Added, above.
- **Dependency audit**: `pip-audit` found 0 known vulnerabilities across
  backend (84 packages) and scraper (42 packages) dependencies.

## [1.5.0] - 2026-08-18

### Added
- Large Order Book indicator for BTC and ETH across Binance and OKX, with a
  live DOM panel, native chart overlays, exchange/threshold filters, optional
  inactive history, synchronized hover state, and per-user preferences.
- PostgreSQL-backed wall lifecycle history with 30-day retention and a
  paginated history API capped at 1,000 rows by default.

### Changed
- Large-order WebSocket traffic now sends one sequenced snapshot on connect
  followed by batched upsert/removal deltas. Sequence gaps trigger an automatic
  reconnect and snapshot resync; empty heartbeat deltas make dropped terminal
  updates detectable without causing React renders.
- WebSocket warmup subscribes to the event bus before replaying current state,
  closing the replay-to-live race. Warmup now sends only the latest candle.

### Fixed
- Reduced average sampled Large Order Book WebSocket payload size by about 92%
  while preserving live updates and reconnect correctness.

## [1.4.0] - 2026-08-17

### Added
- Session Volume Profile indicator with configurable price rows, per-row volume
  hover details, multi-select for ASX, Tokyo, London, and New York sessions,
  support across every chart timeframe, and live current-session updates.

### Changed
- Session profiles render from the left edge of each session and keep the latest
  visible label attached to its corresponding profile.

### Fixed
- Stabilized profile query rendering to prevent chart lag during crosshair moves.
- Prevented profile value labels from displacing the current-price label, and
  removed axis tick marks from price and time labels.

## [1.3.1] - 2026-08-17

### Added
- Collapsible bottom, right, and drawing-tool panels with persistent,
  discoverable controls that remain available while each panel is collapsed.
- ETF Flow values on marker hover, with clearer yellow chart markers.
- Per-user server-side UI preferences backed by PostgreSQL, including chart,
  panel, symbol, timeframe, watchlist, sound, trading-mode, and ETF settings.
  Guests retain local browser persistence, and their settings become the
  initial account snapshot on first login.

### Changed
- Market data and charting now open directly without requiring login;
  authentication remains available for account and trading actions.
- The candle countdown now appears inside the current-price label, matching
  the familiar TradingView placement.
- The indicator and chart-plugin surfaces were simplified to the currently
  useful ETF Flow indicator and Session Breaks plugin.
- The drawing toolbar was consolidated into one grouped left rail.

### Removed
- Unused News and challenge UI, TradingView analytics panel, chart templates,
  legacy indicator choices, and inactive chart-plugin implementations.

### Fixed
- Drawing tools no longer overlap the OHLC legend.
- Collapse controls no longer obstruct panel resizing or disappear when their
  panel is closed.
- Updated vulnerable runtime dependency locks; the production dependency audit
  now reports zero known vulnerabilities.

## [1.3.0] - 2026-08-16

### Added
- **ETF Flow indicator** — a pure context indicator (no trading signal) that
  overlays Farside Investors' BTC ETF daily total net flow onto the chart as
  native `lightweight-charts` markers (green inflow arrow below the candle,
  red outflow arrow above it; zero/missing values show no marker). The same
  BTC flow is shown on both BTC and ETH charts — there is no ETH ETF source.
  Reachable from the existing Indicators menu, no new UI surface.
- New standalone **scraper service** (`scraper/`, its own Docker
  image/dependencies, run as a separate `docker-compose.yml` service, not
  inside the FastAPI process) polls Farside every 30 minutes, parses the
  BTC ETF total-net-flow table, and idempotently upserts into a new
  `etf_flows` Postgres table via Alembic migration. Historical backfill rows
  are inserted with `observed_at = NULL`; genuinely new/live rows get a real
  first-observation timestamp; revisions preserve the original `observed_at`.
- New `GET /api/market-data/etf-flows` REST endpoint (`?from=`/`?to=` date
  range), added to the existing `marketdataApi`/`useEtfFlows` React Query
  hook.
- Live updates flow Postgres trigger → `LISTEN`/`NOTIFY` → a new supervised
  FastAPI background task → the existing `EventBus` → the existing `/ws`
  gateway → the existing `MarketDataBridge`, which upserts the React Query
  cache directly by `flowDate` (no extra REST round-trip per event). A
  NOTIFY only fires for a genuinely new live row or a real value revision —
  never for historical backfill or an unchanged value.

### Changed
- `ws_gateway.py`'s per-symbol WS filtering now also supports global events
  with no `symbol` field (like `EtfFlowUpdated`), which always broadcast to
  every connected client; existing per-symbol filtering for
  `MarketTick`/`CandleUpdate`/`CandleClosed` is unchanged.
- `docker-compose.yml`'s `backend` service gained a healthcheck so the new
  `etf-scraper` service can depend on migrations having actually completed
  before its first run, rather than only on Postgres being reachable.

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
