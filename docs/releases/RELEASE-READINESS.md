# Release readiness — v1.5.0 → first paid release

Status of this document: **assessment, not a commitment.** It records what was
verified in the code on 2026-08-18, what is missing, and what has to be decided
before implementation can start. Nothing here schedules work.

Read [AGENTS.md](../../AGENTS.md) and
[docs/PROJECT-CONTEXT.md](../PROJECT-CONTEXT.md) first. The previous handoff is
[1.5.0-large-order-book.md](1.5.0-large-order-book.md).

---

## 1. Verified baseline (measured, not quoted)

Run on a clean checkout of `main` @ `6c734ed`:

| Check | Result |
| --- | --- |
| `npm run test` | **61 passed / 61**, 9 files, 3.3 s |
| `npm run build` | **passes**, 5.9 s. Main chunk 621 kB (194 kB gzip) — over Vite's 500 kB warning |
| `npm run typecheck` | **117 errors**, *all* in `src/services/queries.ts`. Matches the documented baseline; no new-code errors |
| `npm run lint` | **cannot run** — no ESLint config in the repo |
| `pytest` (backend) | **80 passed, 1 failed, 4 skipped** |
| `npm audit` | **5 vulnerabilities** — 1 critical, 1 high, 3 moderate |

Two things the numbers hide:

- **The backend failure is a non-hermetic test, not a regression.**
  `tests/test_large_order_book.py::test_okx_subscribes_only_to_the_connections_filtered_channels`
  reaches `https://www.okx.com/api/v5/public/instruments` over the live network
  and fails behind any egress restriction. The 1.5.0 handoff recorded "81
  passed" from a machine with open egress. A unit test that needs the internet
  is a CI blocker regardless of which environment it passes in.
- **The audit findings are all in the dev toolchain** (`vite` ≤ 6.4.2 path
  traversal, `esbuild` dev-server request forgery, `vitest`/`@vitest/mocker`,
  `vite-node`). None ships in `dist/`. They are a developer-machine and
  CI-runner exposure, not a production one — but "critical" on the board will
  need either an upgrade or a written accept-and-move-on.

### Test coverage is thinner than the pass rate suggests

The 61 frontend tests cover: session volume profile, ETF flow, market-data
bridge, preferences, the `Button` component, utils, the API facade shape, large
order book, and the drawing-tool rail.

**Nothing covers order placement, order cancellation, position closing, login,
registration, or session restore.** The entire money path is untested on the
frontend. `@playwright/test` is a declared devDependency with no
`playwright.config.*` and no spec files — the e2e harness was installed and
never built.

---

## 2. The four release blockers

The owner named four: safe trading, reliable alerts, idempotent payment, proven
rollback. Current status:

| Blocker | Status | Distance |
| --- | --- | --- |
| Safe trading | **Partially met** — one real hole | Small, well-defined |
| Reliable alerts | **Not met** — no alert system exists | Large |
| Idempotent payment | **Not met** — no payment system exists | Large, and blocked on decisions |
| Proven rollback | **Not met** — no CI, no deploy pipeline, no versioned artifacts | Medium |

### Blocker 1 — Safe trading

**What already holds.** The safety posture here is better than the rest of the
system, and it was clearly deliberate:

- The submit button is disabled while the mutation is in flight
  (`src/pages/trading/OrderPanel.tsx:315-316`) and while the feed is
  disconnected, so ordinary double-clicks cannot double-send.
- There is no silent fallback anywhere. `services/api.ts` throws an explicit
  "not implemented" for every unbacked method rather than no-op'ing.
- OKX errors surface verbatim. `backend/app/api/trading.py` checks
  `sCode != "0"` on every mutating call and re-raises OKX's own `sMsg` as a
  502; the UI renders it (`OrderPanel.tsx:325-329`).
- STOP / TP / SL stay blocked. The STOP button is hard-`disabled` with the
  title "OKX conditional orders aren't wired up yet"
  (`src/pages/trading/OrderPanel.tsx:209-214`), and the modify dialogs refuse
  rather than half-work. This is the correct call and must not be "finished"
  casually — see AGENTS.md.
- Demo and live never mix: `mode` is a required query param on every trading
  route and selects a different credential row and a different OKX host.

**The hole: no idempotency on order placement.**

`request.ts` aborts a request after 20 s and raises `REQUEST_TIMEOUT`
(`src/services/api/request.ts:132`). `OrderPanel.tsx:103-108` then tells the
user, in as many words, *"The server didn't respond in time. Check your
connection and try again."*

But a client-side abort does not cancel the backend. The backend may already
have completed `POST /api/v5/trade/order` against OKX. The user is being
instructed to re-send an order that may already be live. Nothing prevents the
second one landing:

- `backend/app/exchange/okx_client.py:73-92` builds the OKX order body with
  `instId`, `tdMode`, `side`, `ordType`, `sz`, `px`. **No `clOrdId`.**
- `backend/app/api/trading.py:110-133` accepts no idempotency key and keeps no
  record of submitted orders.

OKX supplies the fix natively: a client-supplied `clOrdId` is rejected as a
duplicate if reused. The work is to mint a stable id per user order intent on
the frontend, carry it through `PlaceOrderRequest`, pass it as `clOrdId`, and
translate OKX's duplicate-`clOrdId` rejection into "this order was already
placed" instead of an error. Same treatment for `POST /positions/close`.

Until that exists, blocker 1 is not met — and the timeout copy is actively
telling users to do the unsafe thing.

### Blocker 2 — Reliable alerts

There is no alert system. What exists is a single-session, single-tab,
in-memory approximation:

`src/lib/chart-plugins/drawing-tools/line-alerts.ts` (64 lines) detects when
the live mid price straddles an alert-enabled drawing, with a 30-second
per-drawing cooldown. `ChartPanel.tsx:1708-1728` fires a toast plus a WebAudio
beep. `ChartContextMenu.tsx` has an "Add alert on {symbol} at {price}" item that
creates a horizontal line with `alertEnabled: true`
(`ChartPanel.tsx:1213-1225`). The file's own header comment is accurate:
*"Server-side persistence / offline delivery is a follow-up — there is no trader
alert backend yet."*

Measured against what the roadmap asks for:

| Requirement | Today |
| --- | --- |
| Fires while app is open | ✅ (tab must be open and on that symbol) |
| Fires while app is closed | ❌ nothing runs server-side |
| Mobile | ❌ |
| Desktop | ❌ |
| Discord | ❌ (`queries.ts` has dead PropSim hooks; no backend, no webhook storage) |
| Create from chart right-click | ✅ |
| Manage / mute / edit / delete | ❌ no alert list UI; alerts are a boolean on a drawing, editable only by toggling that drawing |
| Survives reload | ❌ drawings persist to `localStorage`; fired-state does not, and the detector only runs in the open tab |
| Right-click: measurement tool | ❌ the measure tool exists (`manager.ts`, `KeyM`) but is not in the context menu |

The gap is not "polish the existing alerts." It is a subsystem that does not
exist:

- An `alerts` table (no such table — `backend/app/db/models.py` has `users`,
  `refresh_tokens`, `exchange_credentials`, `user_preferences`, `etf_flows`,
  `large_order_levels`).
- A server-side evaluator running against the existing feed, so alerts fire
  with the browser closed. The tick stream and EventBus already exist; the
  evaluator does not.
- A delivery fan-out: Web Push (needs VAPID keys + a service worker — see
  blocker/section 3), and a Discord webhook per user.
- A dedup/at-most-once record so a reconnect or a restart cannot re-fire a
  triggered alert.
- CRUD UI: list, edit, mute, delete.

Note the ordering constraint: **"fires when the app is closed" is a server-side
requirement, and Web Push needs a service worker, which the app does not have.**
Alerts and the desktop decision are coupled; they cannot be sequenced
independently.

### Blocker 3 — Idempotent payment

Nothing exists. No processor SDK, no checkout route, no webhook endpoint, no
`subscriptions`/`payments`/`entitlements` table, no entitlement check anywhere
in the app. The `payment`/`billing` grep hits are false positives (`payload`
in the WS gateway) plus dead PropSim `queries.ts` hooks.

The `users` table has a `status` column defaulting to `"active"` and no
plan/entitlement concept. Today every registered user gets everything.

Three decisions gate all of this — see section 4.

Independent of which processor is chosen, idempotency means specifically:

- A `payments` (or `webhook_events`) table with the processor's event id as a
  **unique** key, written inside the same transaction that grants entitlement.
  Replayed webhooks — which every processor sends — must be a no-op.
- Entitlement derived from processor state, never from a client-side success
  redirect. The success page is a UI hint; the webhook is the source of truth.
- A reconciliation path for the mismatch case the owner listed: payment
  captured, entitlement not granted. This needs to be a query someone can run,
  not a hope.

### Blocker 4 — Proven rollback

`.github/` does not exist. There is no CI, no workflow, no automated test run on
push, no build artifact, no deploy pipeline, and therefore no rollback to prove.
The release process in AGENTS.md (bump → changelog → tag → release) is done by
hand.

Adjacent deployment gaps found:

- **`nginx.conf` sets no cache headers.** Hashed assets are safe, but
  `index.html` is served under browser heuristic caching. After a deploy, a
  returning user can hold a stale `index.html` pointing at asset hashes that no
  longer exist — a white screen. `index.html` needs
  `Cache-Control: no-cache`. This is exactly the "cache of an old version" item
  on the QA list, and it is currently a live risk.
- **The health check is a liveness probe wearing a readiness label.**
  `GET /` returns `{"status": "ok"}` unconditionally
  (`backend/app/main.py:51-53`). It reports healthy with Postgres down, both
  feeds dead, and the large-order-book service crashed. docker-compose gates
  `etf-scraper` on it and would start against a broken backend.
- **No restart policy** on `frontend`, `backend`, or `postgres` in
  `docker-compose.yml` — only `etf-scraper` has `restart: unless-stopped`.
- **Postgres credentials are hardcoded** (`xee_labs:xee_labs`) in
  `docker-compose.yml`, unlike `JWT_SECRET` and `CREDENTIAL_ENCRYPTION_KEY`
  which are correctly required from the environment.
- **No error/latency monitoring.** `posthog-js` is a dependency; there is no
  error tracker.
- **No backup or restore procedure** for Postgres — which will hold, after this
  release, both encrypted exchange credentials and payment records.

---

## 3. Roadmap item 2 — the desktop question

The manifest is real and complete: `public/manifest.json` has `standalone`
display, theme colours, eight icon sizes with maskable variants, and a
shortcut. `index.html` links it and carries the Apple meta tags.

**But there is no service worker.** No registration in `src/main.tsx`, no
`sw.js`, no `vite-plugin-pwa`, nothing in `dist/`. Consequences:

- Chrome/Edge will not fire `beforeinstallprompt` — the app is not installable
  on desktop today.
- iOS "Add to Home Screen" works and gives a standalone shell, but no
  background capability.
- **Web Push is impossible without a service worker**, on every platform. This
  is the coupling to blocker 2.

Note also that iOS only delivers Web Push to a PWA the user has explicitly added
to the Home Screen, and only on iOS 16.4+. "Mobile alerts when the app is
closed" on iPhone means "installed PWA," not "open in Safari." That constrains
the answer to the desktop question more than it first appears.

---

## 4. Decisions required before implementation

These are the owner's calls. Each materially changes what gets built, and the
work behind them cannot start on an assumption.

1. **Desktop form factor.** Installed PWA (service worker + Web Push, one
   codebase, covers desktop and Android; iOS requires Home Screen install), or
   a full Electron/Tauri desktop app (native notifications, auto-update,
   background process, real tray presence — and a second build, signing, and
   release pipeline), or notifications only with no install story.
   *A PWA is the cheapest path that satisfies "alerts when the app is closed"
   on desktop, Android, and iOS, and it is a prerequisite for Web Push in every
   case — so it is worth building even if a native app follows later.*
2. **One-time $10 or $10/month.** This decides whether the schema needs a
   subscription lifecycle (renewals, dunning, cancellation, proration, grace
   periods, expiry) or a single `paid_at` row. It is roughly a 5× difference in
   payment scope, and it also decides whether the refund/cancellation policy
   the QA list requires is a paragraph or a real flow.
3. **Processor.** Stripe (best API and docs, but the seller of record is you —
   you handle VAT/sales tax registration) versus a merchant of record like
   Paddle or Lemon Squeezy (they handle tax and invoicing, higher fee, less
   flexible API). For a $10 product sold internationally by a single operator,
   the tax handling usually dominates the fee difference.

A fourth, smaller decision: **what the $10 actually buys.** Nothing in the app
is currently gated, so "permissions after payment" has no subject. Alerts are
the natural gate — but if alerts are free, the product needs a different paid
surface before payment can be built at all.

---

## 5. QA suite, made concrete for this codebase

The owner's checklist, translated into tests that can actually be written here.
Ordered by blocker relevance, not by the original list order.

### 5.1 Critical paths (currently: zero automated coverage)

Build the Playwright harness that was installed and never used. Against
docker-compose with a seeded OKX **demo** credential:

- register → land in terminal → reload → session restored from `localStorage`
- login with wrong password → server message shown, **not** "Session expired"
  (`request.ts:113-121` guards this specifically — pin it with a test)
- access token expiry mid-session → transparent refresh → original request
  retried, user sees nothing
- refresh token revoked server-side → `session:expired` → clean logout, no loop
- connect OKX credentials → balance, positions, orders populate
- demo ↔ live toggle → every panel refetches; no live data leaks into a demo
  view
- place limit order → appears in Orders → cancel → disappears
- place market order → position opens → close → position gone
- feed disconnected → order submission refused with a warning, not attempted

### 5.2 Trading safety

- double-click submit fires exactly one `POST /trading/orders`
- **20 s timeout scenario: backend succeeds, client aborts.** Assert the second
  attempt does not create a second OKX order. *This test fails today — it is
  blocker 1.*
- OKX rejection (insufficient margin, bad size) renders OKX's own `sMsg`
- STOP button is disabled and carries its explanatory title
- `OrderModifyDialog` / `PositionModifyDialog` refuse rather than silently
  succeed
- no code path calls a `services/api.ts` method that throws "not implemented"

### 5.3 Alerts (write these *with* the feature, not after)

Server-side evaluator: trigger accuracy at the boundary, exactly-once delivery
across an evaluator restart, no re-fire on WS reconnect, correct timezone in the
rendered notification, delivery with the browser closed, delivery on mobile
(installed PWA), Discord webhook success and failure/retry, browser permission
denied → in-app fallback and an honest explanation, offline at trigger time →
queued or explicitly dropped (decide which, then test it), muted alert does not
fire, deleted alert does not fire.

### 5.4 Payments

Success, card decline, user cancellation, double-submit of checkout, **the same
webhook event delivered twice grants entitlement once**, refund revokes
entitlement, and the mismatch case: payment captured with no entitlement row —
detectable by a query, and recoverable.

### 5.5 Chart and data

All symbols (`BINANCE:BTCUSD`, `BINANCE:ETHUSD`, `OKX:BTCUSD`, `OKX:ETHUSD`) ×
all eight timeframes (`config.py:SUPPORTED_TIMEFRAMES`); WS reconnect with
backoff restores a coherent chart; large-order-book sequence gap forces a
snapshot (already implemented — pin it); missing historical range renders a gap,
not a fabricated candle; all indicators enabled together; drawings survive
reload; zoom/scroll-back pagination does not stampede the historical cache
(`HISTORICAL_CACHE_TTL_SECONDS = 5`); right-click menu positions correctly at
every viewport edge (`ChartContextMenu.tsx` clamps in `useLayoutEffect` — test
it).

### 5.6 Devices, performance, accessibility

Chrome/Firefox/Safari/Edge; a real iPhone and a real Android, not just devtools
emulation; tablet; small and large viewports. Long-run soak: leave the terminal
open for hours and watch heap and CPU — the DOM panel and large-order-book churn
are the suspects, and the 1.5.0 handoff explicitly asked for this monitoring.

Accessibility is close to absent: **14 `aria-*` attributes across 10 of 93
source files.** Keyboard navigation, focus management in the Radix dialogs,
contrast, form labels, and alerts that do not rely on colour alone all need a
first pass, not a verification pass.

### 5.7 Security

No rate limiting exists anywhere — `/auth/login` and `/auth/register` accept
unlimited attempts. CORS is hardcoded to `http://localhost:5173`
(`main.py:39`); production is same-origin through nginx so it works, but the
value is wrong and should be configuration. Refresh tokens live in
`localStorage` with a 30-day TTL, so any XSS is a 30-day account compromise —
the server-side revocation table mitigates the aftermath but not the exposure.
Also verify: cross-user isolation on every trading route, that exchange
credentials never appear in a response body or a log line, and that OKX error
text forwarded to the client cannot leak account identifiers.

### 5.8 Database and deployment

`alembic upgrade head` on an empty database and on a copy of the current
production data; downgrade path; large-order-level 30-day retention actually
prunes (`large_order_book.py:19,286`); a documented, *rehearsed* backup and
restore. Then: CI on push, a versioned artifact, a deploy, and a rollback
performed for real — that is what "proven rollback" means.

### 5.9 Product and legal

There are no legal pages of any kind — no Privacy Policy, no Terms, no refund
policy, no "not financial advice" disclaimer. For a paid product that executes
real trades with real money on a real exchange, the disclaimer is not
boilerplate. Every processor requires Terms and a refund policy before they will
approve an account, so this blocks payment integration on the calendar even
though it is not engineering work.

### 5.10 Final UAT

A new user completes registration → payment → OKX connection → first trade,
unaided, without opening DevTools. Nothing counts as ready until someone who has
not seen the app does this.

---

## 6. Suggested sequencing

Derived from the dependencies above, not from the roadmap's order:

1. **Idempotency on order placement** (`clOrdId` end to end) and fix the
   timeout copy. Small, self-contained, closes blocker 1, and it is the only
   blocker where a bug costs the user money today.
2. **CI + the Playwright harness**, with 5.1 and 5.2 as the first specs. Every
   later item is verified by this, so it pays for itself immediately. Fix the
   non-hermetic OKX test as part of this.
3. **Service worker**, once the desktop decision lands. Unblocks installability
   and Web Push.
4. **Alert subsystem**: table → server-side evaluator → delivery fan-out (Web
   Push, Discord) → CRUD UI → the right-click additions (measure tool, alert
   management). Largest item on the list.
5. **Legal pages** — can run in parallel with anything; blocks processor
   onboarding.
6. **Payments**, once decisions 2 and 3 land and there is something to gate.
7. **Deployment hardening**: `index.html` cache headers, a real readiness
   endpoint, restart policies, Postgres credentials out of compose, error
   monitoring, backup/restore, and a rehearsed rollback.
