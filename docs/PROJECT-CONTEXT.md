# Project Context

Durable context about what this project is, why it's built the way it is,
and where it's headed. This is not a status log — task-level progress
belongs in commit history / `CHANGELOG.md`, not here. This file is updated
when the project's goals, scope, or provenance change, not on every task.

## What this is

**Xee.Labs** is a backend-less trading terminal: a candlestick chart
(drawing tools, indicators, watchlist, depth-of-market, order panel) wired
to an in-browser paper-trading engine seeded with real historical OHLC data.
There is no server anywhere in this repo. See
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
- Stated longer-term goal: connect a real backend/API in place of the demo
  engine. See [decisions/0003](decisions/0003-protected-backend-integration-seams.md)
  for the integration seam this goal already shaped.

## Current implementation state (FACT)

- **No backend exists.** `services/demo/engine.ts` is the entire "backend" —
  an in-browser paper-trading engine (module-scoped singletons, resets on
  refresh, starts fully funded) driven by `services/demo/feed.ts` replaying
  real historical Binance OHLC as a synthetic tick stream.
- Chart drawings, chart templates, and chart preferences persist to
  `localStorage` only — no backend involved even in concept.
- `npm run typecheck` currently fails with pre-existing errors in
  `services/queries.ts` / `services/store.tsx`, inherited from the PropSim
  fork. Not expected to be fixed incidentally by unrelated work.
- `npm run lint` has no ESLint config in the repo and fails immediately.

## Known limitations / intentional decisions (FACT)

- Demo account state (positions, orders, balance) is ephemeral and resets on
  page reload, by design.
- The bundled OHLC timeline is normalized — timestamps are shifted so the
  latest bar aligns to "now," but the OHLC values themselves are always
  genuine historical data, never synthetic.
- Bundled demo symbols are crypto-only (sourced from Binance).
- Session replay (`ReplayHUD`, `ReplayScrubber`, `useReplayChartData`/
  `Playback`) is gated off via `REPLAY_ENABLED = false` in
  `pages/trading/constants.ts`; its transport calls real `/api/...`
  endpoints that don't exist in this build.
- `src/pages/AiTraderPage.tsx` is two stub components returning `null` — the
  AI-trader feature is not part of this product.
- `docs/components/COMPONENTS.md` catalogs every UI component with
  screenshots and flags which are unreachable/dead in the current build.

## Known limitations / TODO (unscheduled — not a commitment)

The following PropSim-era leftovers were identified as candidates for
deletion, but nothing has been actioned — this is an agreed-but-not-yet-
scoped backlog, not a plan:

- `services/queries.ts` hooks with zero call sites: leaderboard/competitions/
  certificates, support tickets + coupons, bot integrations + push
  notifications, profile/scaling/profit-split/account-merge (~30+ hooks
  total across these groups).
- AI-trader: the related `queries.ts` hooks plus `src/pages/AiTraderPage.tsx`.
- `services/api/auth.ts` (MFA/devices/sessions), `services/api/market-data.ts`,
  `services/api/journal.ts` — unused REST wrappers; the demo layer stubs
  these instead.
- `googleLogin` in `services/store.tsx` — calls a real endpoint that doesn't
  exist, fails silently.
- The replay session feature needs an actual product decision, not just
  cleanup: either delete it, or it's the first feature to wire up once a
  real backend exists.

Before acting on any of this, confirm scope with the project owner — see
[decisions/0003](decisions/0003-protected-backend-integration-seams.md) for
what must **not** be touched under this same "cleanup" framing.

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
