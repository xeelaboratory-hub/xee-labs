# Project Context

Durable context about what this project is, why it's built the way it is,
and where it's headed. This is not a status log — task-level progress
belongs in commit history / `CHANGELOG.md`, not here. This file is updated
when the project's goals, scope, or provenance change, not on every task.

## What this is

**Xee.Labs** is a trading terminal: a candlestick chart (drawing tools,
indicators, watchlist, depth-of-market, order panel) wired to **real
accounts and real order execution on OKX** (Demo Trading and Live Trading),
fed by a bundled real market-data backend (`backend/`, FastAPI + CryptoFeed)
streaming live Binance and OKX perpetual futures. There is no
mock/demo/paper-trading fallback anywhere — every account, position, order,
and fill shown in the terminal is a real round-trip to OKX's API for the
credentials the signed-in user connected. See
[architecture/OVERVIEW.md](architecture/OVERVIEW.md) for how that's built.

## Provenance (FACT)

This repository is not a single app — it's three stacked apps:

1. **OpenCharts v1** — the original full-stack app (Next.js 14 + Express +
   PostgreSQL + Redis, custom Canvas 2D chart engine, CCXT multi-exchange, a
   Pine Script transpiler).
2. **PropSim terminal fork** — v1 was wiped and replaced wholesale by a
   different pre-existing app: a Vite+React terminal built on
   `lightweight-charts`, originally the trading UI for a prop-firm-challenge
   SaaS product called "PropSim."
3. **Xee.Labs (current)** — a rebrand of the PropSim fork. All app-facing
   "OpenCharts" strings, comments, and metadata were renamed to "Xee.Labs"
   (`index.html`, `manifest.json`, `App.tsx`, `services/api.ts`,
   `services/ws.ts`, `AiTraderPage.tsx`, `vendor/types.ts`,
   `fetch-demo-data.mjs`, `README.md`). A `Footer` component was added
   showing "Xee.Labs" plus a live version badge read from `package.json`.

**Why this matters:** the PropSim fork brought its entire client-side API
surface with it. `services/queries.ts` exports dozens of real, typed hooks
for features that don't exist in this build (leaderboards, competitions,
AI-trader, bot integrations, push notifications, MFA, …) with zero UI
consumers. Don't infer a working feature from a hook's existence there —
see [architecture/OVERVIEW.md](architecture/OVERVIEW.md).

## Repository identity (FACT)

- Public repository: `https://github.com/xeelaboratory-hub/xee-labs`,
  owned by the project's author (not a fork tracked against an upstream —
  see [decisions/0001](decisions/0001-private-fork-no-upstream.md)).
- Local working directory name (`OpenCharts`) is unchanged — only in-app
  branding was renamed, not the folder.
- The browser tab title reads "Xee.Labs DEV MODE" only when running under
  `npm run dev` (`import.meta.env.DEV` check in `main.tsx`); the
  loading-screen text and production title stay plain "Xee.Labs." This is a
  deliberate choice — the dev/prod distinction is scoped to the tab title
  only, not general UI text.

## Current goals (current/temporary — not a permanent decision)

- GitHub issue **#3** ("feature: ui improvements") tracks the broader,
  currently open-ended goal of "tailor UI to my needs." Its done-criteria
  are not yet defined. Treat this as the umbrella under which incremental UI
  work is currently happening, not as a fixed spec — check the issue itself
  or ask before assuming scope.
- **Phase 4 (real exchange integration, replacing the demo layer) is
  complete** — see "Current implementation state" below. Order Book
  persistence (Large Order Book), Large Order Statistics, ETF Flow, and
  Session Volume Profile were explicitly scoped out of Phase 4 as separate
  future work — all four have since shipped: ETF Flow in v1.3.0, Session
  Volume Profile in v1.4.0, Large Order Book (with full Postgres-backed
  history) in v1.5.0. See `CHANGELOG.md` for details; don't rely on this
  file alone for current feature status without cross-checking it.

## Current implementation state (FACT)

- **A real market-data backend exists** (`backend/`, FastAPI + CryptoFeed) —
  serves symbols and historical candles over REST, and live ticks + 1-minute
  candle updates over a WebSocket, for Binance and OKX perpetual futures
  (BTC, ETH on both exchanges; symbol ids are exchange-qualified, e.g.
  `BINANCE:BTCUSD`, never merged across exchanges).
- **The same backend also owns auth, users, and OKX trading** — Postgres
  (`users`, `refresh_tokens`, `exchange_credentials` tables, Alembic
  migrations) backs real multi-user registration/login (JWT access tokens +
  rotating, revocable refresh tokens), and per-user encrypted OKX API
  credentials (Fernet, server-side key) drive real account balance,
  positions, open orders, place/cancel order, close position, and trade
  history calls against OKX's REST API — both OKX **Demo Trading** and
  **Live Trading** environments, selected per-request via a `mode` param
  (`demo` | `live`), never mixed.
- `docker-compose.yml` runs four services — `postgres` (internal only),
  `backend` (runs `alembic upgrade head` automatically on container start,
  then serves on `127.0.0.1:3000` — host-local only, not externally
  reachable), `frontend` (nginx on `:8080`, reverse-proxying
  `/api`/`/ws` to `backend`), and `etf-scraper` (no published port, keeps
  `etf_flows` current against the same Postgres). See
  [architecture/OVERVIEW.md](architecture/OVERVIEW.md).
- `services/api.ts` calls the real backend for everything the UI needs — no
  Proxy fallback, no mock data. A method with no real backend implementation
  (leaderboards, competitions, AI-trader, bot integrations, trade journal,
  and other PropSim-era surface with zero UI consumers) throws a clear "not
  implemented" error instead of silently no-op'ing.
- There is **no paper-trading engine anymore** — `services/demo/*` was
  deleted in Phase 4, along with the session-replay feature and the dead
  `services/api/{auth,journal,accounts}.ts` REST wrappers.
- Chart drawings and chart templates persist to `localStorage` only — no
  backend involved even in concept (unchanged since before Phase 4). Chart
  **preferences** are different: they're backend-synced for logged-in users
  (`backend/app/api/preferences.py`, a real `user_preferences` Postgres
  table) — `App.tsx` loads them from the server on login and debounce-saves
  local changes back (500ms) via `PUT /api/preferences`. `localStorage` is
  only the source of truth for logged-out/offline use.
- `npm run typecheck` and `npm run lint` are both clean repo-wide. This
  reversed twice: the typecheck errors were confined to `services/queries.ts`
  and `hooks/useTraderPreferences.ts` until `v1.6.3` removed the dead hooks
  behind them, and ESLint had no config at all until `v1.6.4` added one
  (`eslint.config.js`). The baseline is 0 errors / 0 warnings — see AGENTS.md
  on why a warning here is worth reading rather than tolerating.

## Known limitations / intentional decisions (FACT)

- **OKX conditional/algo orders are only partly wired up.** Take-profit and
  stop-loss **on order placement** ship as of `v1.9.0` — they ride along with
  the entry order as an OKX `attachAlgoOrds` bracket, so the stop the Position
  Builder sizes a trade from actually reaches the exchange. What is still
  **disabled in the UI** with an explicit "not supported yet" message — not
  silently dropped — is everything needing OKX's separate `order-algo`
  endpoints: editing TP/SL on an *existing* position, amending a pending
  order, and STOP as a standalone order type (the chart's right-click quick
  order). Those remain distinct, not-yet-scoped pieces of work.
- **No real-time push for positions/orders/account balance.** The backend's
  `/ws` gateway only streams market data — OKX's private WS channels
  (account/positions/orders) aren't wired in. The frontend keeps these fresh
  via REST polling — positions/orders every 30s, account balance every 15s
  (`useAccount`'s tighter interval closes a gap where the displayed balance
  could otherwise go stale between trades) — plus an immediate refetch after
  each trading mutation.
- Trade history comes from OKX's fills-history endpoint — a flat list of
  individual executions (symbol, side, price, fee, realized P&L, timestamp),
  not a paired open/close "closed position" record. OKX doesn't expose
  position lifecycle pairing directly, so this is an honest single-price
  trade log rather than a fabricated entry/exit pair.
- Crypto perpetuals only — BTC and ETH on Binance and OKX. Wire your own
  adapter for other assets or exchanges.
- `src/pages/AiTraderPage.tsx` is two stub components returning `null` — the
  AI-trader feature is not part of this product.
- `docs/components/COMPONENTS.md` catalogs every UI component with
  screenshots and flags which are unreachable/dead in the current build —
  note it predates Phase 4 and may reference removed demo-mode components.

## Known limitations / TODO (unscheduled — not a commitment)

- `services/queries.ts` hooks with zero call sites: leaderboard/competitions/
  certificates, support tickets + coupons, bot integrations + push
  notifications, profile/scaling/profit-split/account-merge, trade journal,
  analytics, payouts (~60+ hooks total across these groups — grew after
  Phase 4 removed the demo stubs that used to make some of them look live).
  All throw a clear error via `services/api.ts` if ever called; none are.
- AI-trader: the related `queries.ts` hooks plus `src/pages/AiTraderPage.tsx`.
- `googleLogin` in `services/store.tsx` — calls a real endpoint that doesn't
  exist, fails silently. Predates Phase 4; Phase 4's real login/register flow
  doesn't use it.
- `useTraderPreferences.ts`'s `getPreferences`/`savePreferences` calls — the
  hook that makes them (`useTraderPreferences()`) is never actually invoked
  anywhere; only its sibling helper functions (`readTraderPrefs`,
  `writeTraderPrefs`, both `localStorage`-only) are used directly.
- OKX conditional/algo orders — the remaining three: TP/SL on an existing
  position, amend order, and STOP as an order type. See "Known limitations /
  intentional decisions" above. TP/SL at placement shipped in `v1.9.0`; these
  three still need the `order-algo` endpoints, and are the main remaining
  piece of real trading functionality, not cleanup.
Before acting on any of this, confirm scope with the project owner. (Order
Book persistence, Large Order Statistics, ETF Flow, and Session Volume
Profile used to be listed here as scoped out of Phase 4 — all four have
since shipped, see "Current goals" above; this line intentionally removed
rather than left stale.)

## Known documentation gaps

- A deep, step-by-step trace of the WS-event → UI data flow is being
  prepared separately (not yet part of this doc set) — don't assume its
  absence here means the flow is undocumented elsewhere; check before
  writing a new version.
- `README.md`, `package.json` (`"name": "opencharts"`), and `LICENSE`
  (`OpenCharts Contributors`) still reflect the project's open-source
  origins and have not been updated for the private-product rebrand. This
  is deliberately deferred to a separate rebrand-cleanup pass — see
  [decisions/0001](decisions/0001-private-fork-no-upstream.md).
