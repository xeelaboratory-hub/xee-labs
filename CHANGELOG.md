# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.12.0] - 2026-08-21

### Fixed
- **Five of the eight timeframes were unreachable on a phone.** The toolbar
  lays them out as a chip strip, and on a 375px screen that strip runs past
  the edge of an `overflow-x-auto` row: `15m` sat half-clipped and `30m`
  through `1w` were off-screen entirely, with nothing on the toolbar
  suggesting they existed. The only way to them was a horizontal scroll that
  shares its axis with the chart's own pan gesture — not a gesture anyone
  discovers by accident.

  On mobile the strip is now a dropdown. The current timeframe stays visible
  on the trigger, and the other seven sit one tap away in a sheet where each
  is a full 44px target. Desktop keeps the chip strip unchanged — it has the
  room, and a pointer picks a chip faster than it opens a menu.

  The two are mounted by breakpoint rather than hidden by one (`useIsDesktop`,
  the same hook `TradingPage` uses to choose its panels). Rendering both and
  hiding one with `md:` would put two controls for the same value in the tree
  and have a screen reader announce all sixteen.

- **Rotating a phone into landscape loaded the desktop terminal.** The layout
  switch asked one question — `(min-width: 768px)` — and an iPhone 13 in
  landscape is 844px across. It cleared that, so the right panel, the bottom
  panel and the desktop footer all mounted into 390px of height, and the tab
  bar disappeared with them because it was hidden by the same breakpoint.
  Measured result: a chart about 145px tall, *smaller than in portrait*, in
  the one orientation people rotate to for the chart.

  The switch now has to clear both axes (`min-height: 500px`), which separates
  every phone in landscape from every tablet with room to spare. Landscape
  keeps the phone layout: full-width chart, tab bar, no desktop furniture.

  Two things went with it. The right-panel toggles now mount with the panel
  they drive — on a phone they were live buttons over a panel that never
  renders, so a tap changed state and nothing on screen. And the drawing rail
  asks the same two-axis question, instead of unfurling a full-height tool
  column across the chart the rotation was for.

  Page structure follows this decision; leaf-level `md:` styling still keys on
  width alone. In landscape that means desktop sizing on a touch device — a
  smaller problem than the layout one, and not worth rewriting 64 classes to
  chase.

- **Indicators were unreachable on a phone.** Not hidden behind a gesture —
  absent: the toolbar button carried `hidden md:block`, and nothing else
  offered them. The settings dialog covers Appearance, Colors, Trading and
  Events; the chart's context menu can only *clear* indicators, and only once
  some are already on. There was no way to turn one on from a phone at all.

  The button now has a mobile form — an icon with the active count, opening
  the registry in a sheet. Both form factors render the same `IndicatorList`,
  differing only in target size, so the Session Volume Profile's own controls
  (its four market toggles and row count) cannot exist on one and go missing
  from the other. The sheet scrolls independently, since the registry outgrows
  a phone screen once that profile is expanded.

## [1.11.0] - 2026-08-21

### Changed
- **Self-service registration is now closed by default.** `POST
  /api/auth/register` answers 403 unless `REGISTRATION_OPEN` is set to an
  explicit affirmative. The reason is exposure rather than policy: the
  `frontend` container publishes `:8080` on every interface and nginx proxies
  `/api` to the backend, so signup was reachable from anything on the local
  network — while this instance serves a single operator account. That made an
  open endpoint a path from "someone on the network" to "authenticated user"
  that nothing here needed.

  The flag fails closed on anything it does not recognise, an unset variable
  and a misspelled value included: a typo must not be the thing that opens
  signup. The check runs ahead of the rate limiter, so hammering a closed
  endpoint cannot exhaust the budget that protects an open one, and it refuses
  before touching the database — a 403 that still wrote a user row would be
  worse than no check at all.

  Turn it on when the product sells accounts; the signup half of a paid
  release cannot work without it.

## [1.10.0] - 2026-08-21

### Added
- **Every order now carries an idempotency key, and an interrupted submission
  is resolved instead of re-sent.** `request()` gives up on a call after 20
  seconds and reported a timeout — but a client-side abort does not cancel
  anything: the backend may already have placed the order, and OKX may already
  have filled it. The UI then told the user, in as many words, that the server
  had not responded and to *try again*. That is an instruction to place a
  second order on top of a first one they cannot see.

  Order placement and position closing now mint a client order id (OKX's
  `clOrdId`, alphanumeric and at most 32 characters) and send it with the
  order. Because the caller names the order before the exchange does, an
  interrupted submission has a question that can be asked afterwards, without
  the `ordId` that never came back: `GET /api/orders/by-client-id` looks the
  order up by that key. A 404 there is a real answer — nothing was placed.

  Three outcomes are now kept apart, and each says something different to the
  user: the order is live (reported as success, "Order Already Live"), nothing
  was placed (`ORDER_NOT_PLACED` — safe to retry, and the copy says so), or the
  lookup itself could not reach the exchange (`ORDER_STATUS_UNKNOWN` — check
  before retrying). The old copy collapsed all three into "try again."

  The lookup is attempted twice. An order that reached OKX moments before our
  own deadline expired can miss the first attempt, and of the two possible
  wrong answers, a false "nothing was placed" is the one that costs money.

### Changed
- The backend resolves its own ambiguity before answering. Two failures are
  worth a second question rather than a 502: OKX rejecting a duplicate
  `clOrdId` (`51016`), which means the order is already working, and an error
  carrying no OKX code at all, which is a transport failure where the request
  may well have completed. Both are answered by looking the order up. Every
  other code is OKX naming a rejection — definitive, and not re-asked.
- OKX's per-order rejection reason now surfaces instead of its generic
  envelope. A rejected order is reported twice by the exchange: `"1"` /
  `"Operation failed."` at the top level, and the actual cause in
  `data[0].sCode`/`sMsg`. The client kept the first pair, so every rejection
  reached the user as "Operation failed" with no cause named — and a duplicate
  id was indistinguishable from a real rejection.

### Verification
- 192 backend tests (29 new), 184 frontend tests (16 new), typecheck and lint
  clean. The new lookup route was exercised against live OKX read-only: an id
  the exchange has never seen returns 404 through the full path, which is
  OKX's `51603` mapped to "no such order".
- **No order round-trip was run.** This instance has OKX *live* credentials
  only — there is no `is_demo` credential row — and placing a live order to
  test order placement is not something this repo does. The paths that write
  (`clOrdId` on the wire, `51016` recovery) are covered by tests against a
  recording client, not by an exchange.

## [1.9.0] - 2026-08-21

### Added
- **Take-profit and stop-loss now reach OKX with the order.** The Position
  Builder sizes a trade *from* its stop — risk % of equity and leverage decide
  the contract count, and the stop price falls out of that model. It showed
  that stop on screen, drew it on the chart as a preview, and then dropped it:
  `handleApply` sent symbol, side, type, quantity and price and nothing else.
  Every position opened from the panel was naked, while the UI said otherwise.

  Both legs now ride along with the entry order as an OKX `attachAlgoOrds`
  bracket (`POST /api/v5/trade/order`), rather than being placed as separate
  algo orders afterwards — there is no window in which the position exists
  unprotected. The take-profit is attached only when an R:R is set, since that
  is what derives it; the stop is always attached, because the panel cannot
  size a position without one.

  Two details in the bracket are load-bearing. `tpOrdPx`/`slOrdPx` are `"-1"`,
  OKX's sentinel for "execute at market when triggered" — a real limit price
  there would let the protective exit go unfilled in exactly the fast move it
  exists for. And `tpTriggerPxType`/`slTriggerPxType` are pinned to `"last"`
  instead of OKX's default, so the trigger reference matches the last-price
  feed that the chart and the stop model are both built on; mark price would
  fire on a number the user never saw.

  The order confirmation dialog already had TP/SL rows — they had simply never
  been populated. They now show the same stop and target the panel sized from,
  and the success toast names them.

### Changed
- Order validation now checks each bracket leg sits on the side of the entry
  where it does its job. A stop-loss above a long's entry triggers the instant
  the order fills, closing the position it was meant to protect; OKX rejects
  some of these itself but not uniformly, so both sides check it and name the
  offending field. The split is deliberate: the backend can only check `LIMIT`
  orders, which carry their own reference price, while a `MARKET` order has no
  server-side entry to compare against and is checked client-side against the
  live tick. When no reference exists at all — a market order placed before
  the first tick arrives — the bracket passes through unchecked rather than
  being judged against a guessed price.

### Fixed
- `services/schemas.ts` no longer points at `OrderPanel.tsx`, deleted in 1.6.1
  when `PositionBuilderPanel` absorbed order placement.
- `docs/PROJECT-CONTEXT.md` claimed `npm run typecheck` fails and `npm run
  lint` has no config. Both have been clean since 1.6.3 and 1.6.4
  respectively.

### Still not supported
Three of OKX's four conditional-order surfaces remain stubbed with their
existing "not supported yet" messages, all needing the separate `order-algo`
endpoints rather than an attached bracket: editing TP/SL on an **existing**
position, amending a pending order, and STOP as a standalone order type (the
chart's right-click quick order).

## [1.8.1] - 2026-08-21

### Fixed
- **Preference sync was broken in both directions**, and had been since
  Position Builder and the session volume profile shipped.
  `PreferencesPayload` declares `extra="forbid"` and never learned four keys
  the frontend sends — `rightPanel: "position-builder"`,
  `sessionVolumeProfileRows`, `sessionVolumeProfileMarkets` and
  `sessionVolumeProfileMarket`.

  Every `PUT` returned 422, so nothing synced. And because a stored row
  already held those keys, `GET` returned 500 while validating it, so
  preference loading failed outright rather than degrading. Settings only
  ever lived in `localStorage` and never followed the user to another device
  — including the panel choice and volume profile settings added in 1.8.0.

  Row bounds are `ge=10, le=100`, matching
  `normalizeSessionVolumeProfileRows` in `services/preferences.ts`; if the two
  disagree, a value the UI considers valid gets rejected by the API.
- Reading stored preferences no longer fails the request. The 500 above is
  what a strict read gives you whenever client and server versions differ,
  and it would recur identically the next time a field is added. Reads now
  drop keys this version cannot parse and return the rest, falling back to
  defaults only if nothing survives. Writes stay strict — a forgiving write
  path would let a typo persist silently, indistinguishable from a real
  setting.

## [1.8.0] - 2026-08-21

### Added
- **Session volume profile levels in the trade panel.** The indicator already
  computed POC, VAH and VAL, but `useSessionVolumeProfile` returned only its
  `primitiveRef` — the numbers went into the chart overlay and nothing else
  could reach them. The hook now also returns a summary, travelling the same
  route `positionBuilderPreview` takes in the opposite direction: computed in
  `ChartPanel` (which owns the visible range the profile depends on), lifted
  to `TradingPage`, handed down to `PositionBuilderPanel`.

  Only scalars leave the hook. The full profile carries every histogram row
  and is recomputed on each visible-range change; pushing it up the tree
  would re-render the whole trading screen on every scroll.

  With several markets selected, the panel shows the most recent session —
  the developing one while a market is open — since that is the profile
  describing where price is now.
- **A button that applies a profile level as the limit entry**, alternating
  between POC and VAH. It shows the level it will apply next and the price it
  will use.

  It forces the order to Limit: `entry` only reads `limitPrice` in limit mode,
  so applying a level without that switch would set a value the order
  silently ignores. Applying is a one-shot snapshot rather than a
  subscription — the developing session's POC drifts, and a limit price that
  moves under the trader while they read the plan is worse than one a few
  points stale.

### Fixed
- The entry button initially wrote a raw profile value such as
  `76451.67166666666` into the price field. The panel displayed `76,451.67`
  either way, so it looked correct — a profile level is a histogram bucket
  boundary, not a tradeable price, and the exchange rejects it. Levels now go
  through the existing `roundToTick`, the same helper the stop and
  take-profit already use.

### Changed
- `resolveProfileEntry` and `summarizeLatestProfile` extracted from inline
  component code into `positionBuilder.ts` and `session-volume-profile.ts`
  respectively, so both are testable. Behaviour unchanged; 10 tests added.

## [1.7.2] - 2026-08-21

Root cause of the price freeze that 1.6.5 through 1.7.0 were treating
symptoms of. Found by running the app's own OKX feed in an isolated probe
with cryptofeed's logging turned on.

### Fixed
- **A dropped exchange WebSocket was never reconnected.** OKX's `/public`
  socket drops with an abrupt EOF every few minutes. cryptofeed's
  `ConnectionHandler` loops `while retries <= self.retries`, so the
  `retries=0` setting meant a single drop retired that socket permanently
  ("failed to reconnect after 1 retries - exiting").

  Ticker and book ride `/public`; candles ride `/business` and survived. In
  the probe, ticker froze at 643 events and book at 940 while candles climbed
  from 613 to 838 — traffic never stopped, so the watchdog never fired and
  prices stayed frozen. That is the whole mechanism behind the mispricing.

  Both feeds now use `CONNECTION_RETRIES` (10), so a transient drop heals in
  about a second while a genuinely broken feed still exhausts its retries and
  escalates to the supervisor. Binance had the same latent failure — just
  fewer sockets to hide behind — and gets the same treatment.
- cryptofeed's own logging went from disabled to WARNING. Its connection
  errors were being swallowed entirely, including an
  `asyncio: Task exception was never retrieved`. That silence is why this
  needed a dedicated probe rather than being readable in the logs.

### Added
- A second watchdog trigger on the price clock at 120s, alongside the
  existing 60s traffic trigger — a feed can be busy and priceless at the same
  time. The threshold is measured, not guessed: 80 samples over 5.5 minutes
  of live operation showed a maximum tick age of 70s, leaving a 50s margin.
  1.6.5 keyed the *only* watchdog to ticks at an unmeasured 60s and
  restart-looped a healthy feed; this is an additional trigger, not a
  replacement.

### Known
This makes a dropped socket recover; it does not stop OKX from dropping it.
Roughly 9% of samples still show a tick age above 60s, so the stale-data
banner added in 1.7.0 will appear during those stretches — accurate rather
than noisy, since the displayed price really is a minute old.

## [1.7.1] - 2026-08-21

### Fixed
- ETF flow markers were anchored to the scrape timestamp rather than the day
  they describe. `computeEtfFlowMarkers` used `observedAt` when present,
  falling back to the flow's own date otherwise — but `observedAt` is scrape
  provenance, not an event time: per `backend/app/db/models.py` it is "NULL
  for historical backfill rows and set to the scraper's first-observation
  time for genuinely new rows".

  That caused two problems at once. Markers landed wherever the scraper
  happened to run instead of on their `flowDate`, and because backfilled rows
  carry NULL while freshly scraped rows carry a timestamp, adjacent days on
  the same chart could be positioned by two different rules.

  Markers now always anchor to `flowDate`. `observedAt` still travels through
  the API contract and is used elsewhere; it is simply no longer treated as
  an event time.

## [1.7.0] - 2026-08-21

Closes the incident chain that ran through 1.6.5 and 1.6.6: one health signal
was answering two different questions, and each attempt to fix it for one
question broke the other.

### Added
- **`lastTickAt` on `/api/market-data/health`**, alongside the existing
  `lastEventAt`. `lastEventAt` is advanced by any feed traffic and answers
  "is the connection alive" — it feeds the runner's watchdog, and acting on
  it destroys and rebuilds a feed, so it must stay broad. `lastTickAt` is
  written only by the ticker callback and answers "are prices arriving" — it
  feeds the stale-data banner, and acting on it only shows a warning, so it
  can be strict. Both use the store's existing pass-`None`-to-preserve
  convention, so a callback that can't vouch for a clock leaves it alone
  rather than inventing a timestamp.
- **The stale-data banner is now actually on screen.** `StaleDataBanner` had
  been written and tested but was imported by nothing except its own test
  file — `AGENTS.md` described it as active, which had drifted from reality.
  That is why nothing warned during the 37-minute price freeze: the component
  was never mounted. It now sits in `TradingPage` beside `MarketClosedBanner`
  and judges staleness on `lastTickAt`.

### Changed
- The banner's staleness threshold is 60s, chosen from measurement rather
  than intuition. OKX's ticker cadence proved bimodal: one 95-sample window
  ran 94 gaps at 5s or under with a single 75s stall, while a later 90-sample
  window showed 57 samples above 30s and a maximum of 83s. 60s clears the
  fast mode's worst case and still surfaces a frozen feed within a minute;
  firing during the slow mode is honest rather than a false positive.
- The 30s guard in `src/lib/livePnl.ts` is deliberately left tighter — it
  only falls back to the exchange's own authoritative value, so triggering
  early costs nothing.

### Known

OKX's ticker cadence swinging between 1s and 83s is itself suspicious and may
share a root cause with the original freeze. This release makes it visible
rather than fixing it.

## [1.6.6] - 2026-08-21

### Fixed
- **Regression from 1.6.5: OKX's feed was restarting every 115 seconds.**
  1.6.5 narrowed the feed health timestamp to ticker events only so that a
  dead ticker channel would be detected. That coupled the runner's
  *connection liveness* watchdog to *price freshness*, which are not the
  same signal. OKX's ticker arrives roughly once every 55–60s, just under
  the watchdog's 60s threshold, so a perfectly healthy feed was torn down
  and rebuilt on a fixed cycle.

  Candle and book callbacks advance the clock again; the timestamp means
  "the connection is alive", which is what the watchdog reads it for.

  The $49 mispricing fixed in 1.6.5 is unaffected. That guard lives in
  `src/lib/livePnl.ts`, reads each tick's own exchange timestamp, and never
  consulted the health field — reverting the backend half does not bring the
  bug back.

  A complete fix needs a separate `lastTickAt` so liveness and price
  freshness get their own clocks and thresholds. That changes the health
  response shape, which `AGENTS.md` treats as a protected contract, so it is
  left for a deliberate change rather than folded into a hotfix.

### Changed
- `backend/tests/test_feed_freshness.py` now pins both failure directions —
  that a fresh clock does not imply a fresh tick, and that non-ticker
  traffic must keep advancing the clock — so neither can be reintroduced by
  fixing the other.

## [1.6.5] - 2026-08-21

### Fixed
- **A dead ticker channel could silently misprice open positions.** OKX's
  ticker channel died while its candle and book channels kept flowing. Both
  OKX symbols froze at the same instant and stayed frozen for 37 minutes,
  during which the UI showed −$6.93 on a live position the exchange valued
  at +$42.49 — a $49 error with the sign inverted, and no warning anywhere
  in the app.

  Nothing caught it because every callback in `backend/app/feeds/_common.py`
  advanced the same health timestamp, while only the ticker callback writes
  `store.set_tick`. Candle and book events kept `lastEventAt` fresh, so the
  runner's 60s watchdog never restarted the feed and the frontend's
  stale-data banner never fired.

  Only the ticker callback advances that clock now; candle and book
  callbacks affirm `connected=True` but pass `last_event_at=None`, which
  `store.set_health` already treated as "keep the existing timestamp". The
  clock now means *prices are flowing*, which is what both the watchdog and
  the banner were always asking it.
- `computeLivePnl`/`computeLivePrice` ignore a tick older than 30s and
  return the server snapshot instead. The scaling math was never wrong — it
  faithfully turned the exchange's correct value into a wrong one because
  its input was stale. The exchange's mark price is authoritative.
- Chart primitives detached from the wrong series. `useLargeOrderBookPrimitive`
  and `useSessionVolumeProfile` read `candleSeriesRef.current` in effect
  cleanup, but `chartEpoch` is incremented only *after* `ChartPanel` has
  written the new series into that ref — so on a theme or symbol change,
  cleanup ran against the replacement series rather than the one the
  primitive was attached to. Both now capture the series in a local.
- The preference-load effect in `App.tsx` keys off a stable `userId` rather
  than referencing `user` while listing `user?.id`, so a session refresh for
  the same account no longer risks reloading preferences and flashing
  `preferencesReady` back to false.

### Changed
- `validateOrderInput` moved out of `PositionBuilderPanel.tsx` into
  `src/pages/trading/order-validation.ts` — a non-component export degraded
  Fast Refresh for the whole module.
- Lint baseline is now **0 problems**, down from 0 errors / 5 warnings.

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
