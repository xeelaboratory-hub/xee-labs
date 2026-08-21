# Handoff

Context for an agent picking this repo up from a previous session.

This file carries only what the repo can't tell you on its own: which traps
have already been paid for, and what was left open. Everything durable lives
elsewhere and is authoritative over this file.

**Read first:** [AGENTS.md](../AGENTS.md) — how to work here. Then
[docs/PROJECT-CONTEXT.md](PROJECT-CONTEXT.md) — what this project is.
[CHANGELOG.md](../CHANGELOG.md) explains every release.

Do **not** trust implementation details in
[docs/architecture/OVERVIEW.md](architecture/OVERVIEW.md) or
[docs/components/COMPONENTS.md](components/COMPONENTS.md) — file lists, line
counts, and "is this still called" claims drift. Verify against the code.

---

## Traps that have already cost time

These are the durable part of this document. They are not obvious, and each
one produced a wrong conclusion before it was understood.

**`docker compose restart backend` runs the old image.** Neither the backend
nor the frontend container mounts source; both bake it at image-build time. A
backend code change reaches a container only through
`docker compose up -d --build backend`. Verifying against a merely restarted
container measures code you did not write, and it looks exactly like a pass —
this produced a "verified against the live instance" claim in a release that
was measuring pre-change behaviour, and the regression it missed had to be
reverted in the next release.

**Console errors during editing are usually HMR artifacts.** Editing a file
that a live page has already loaded produces hook-order errors and
`X is not defined` for symbols mid-edit. Before concluding there is a bug,
reload in a **fresh tab**. Twice this session an error looked like a real
defect and was not; once the reverse test (stash the change, reload, see if
it persists) was the only way to tell.

**Measure before choosing a threshold, and measure more than once.** OKX's
ticker cadence is bimodal: one window showed 94 of 95 gaps at ≤5s, a later
window showed 57 of 90 samples above 30s with a maximum of 83s. A threshold
picked from a single window shipped a regression that restart-looped a healthy
feed every 115 seconds.

**A number that renders correctly can still be wrong.** A volume profile level
displayed as `76,451.67` while writing `76451.67166666666` into the order
field. Reading the DOM, not the screenshot, is what caught it.

---

## State at handoff

*Volatile — verify rather than trust. Accurate as of 2026-08-21, `v1.9.0`.*

`main` is green on every gate:

```bash
npm run typecheck                 # 0 errors
npm run lint                      # 0 problems
npm run test                      # 155 passed
cd backend && pytest              # 162 passed, 4 skipped, 1 failed
```

That one backend failure is open item 5 below — a test that makes a live call
to `www.okx.com` and cannot pass without outbound network access. It fails
identically on a clean checkout.

Whether the environment is already running depends on where you picked this
up. On the author's machine it usually is; a fresh cloud container has
nothing running and no Docker daemon, and needs `npm ci` before the frontend
gates will even start. Check before starting anything, per the port hygiene
rules in AGENTS.md:

- `docker compose`: `postgres`, `backend` (127.0.0.1:3000), `frontend` (:8080),
  `etf-scraper`
- Vite dev server on :5173

`v1.6.2` through `v1.9.0` all shipped on 2026-08-21. The chain worth reading
before touching the feed layer is **`v1.6.5` → `v1.7.2`**: four releases
chasing one mispricing bug to its root, a WebSocket that dropped and was never
reconnected. Two of those releases were corrections of the previous one.

**`v1.9.0` was verified against tests only.** No live OKX demo round-trip was
run — the container it was built in has no backend, no Postgres and no
outbound access to OKX. Before trusting the attached bracket in the terminal,
place one `mode=demo` order from the Position Builder and confirm the stop and
target appear on the OKX side. Per the first trap above, rebuild the backend
image (`docker compose up -d --build backend`) rather than restarting it.

---

## Open items

*Volatile — none of these are scheduled.*

1. **OKX's ticker cadence swings between 1s and 83s.** `v1.7.2` makes a dropped
   socket recover; it does not stop OKX from dropping it. The cause is
   upstream. Now visible via `lastTickAt` and the stale-data banner, not fixed.
2. **Three hooks in `src/services/queries.ts` have no call sites** —
   `useEconomicCalendar`, `useModifyOrder`, `useModifyPosition`. They
   type-check, so they were left out of the `v1.6.3` cleanup that removed 67
   others. Deletion needs owner approval (see AGENTS.md constraints).
3. **`AiTraderPage.tsx` is unreachable** — `TradingPage.tsx` hard-codes
   `aiTraderEnabled = false`, so neither the bottom-panel tab nor the
   right-panel entry can be selected. It is still imported and bundled.
   Deletion needs owner approval (see AGENTS.md constraints). Its former
   companion in this item, `useTraderPreferences.ts`, is **not** dead —
   `readTraderPrefs`/`writeTraderPrefs` back `useChartPreferences` and
   `drawingStyles`, both of which `ChartPanel`, `TradingPage` and
   `DrawingToolsOverlay` use. Only the `useTraderPreferences()` hook itself is
   uncalled.
4. **Three of OKX's conditional-order surfaces are still stubbed** —
   TP/SL on an existing position, amending a pending order, and STOP as an
   order type. `v1.9.0` wired up only the fourth (TP/SL attached at
   placement); the other three need OKX's separate `order-algo` endpoints.
5. **`backend/tests/test_large_order_book.py` makes a live network call.**
   `test_okx_subscribes_only_to_the_connections_filtered_channels` reaches
   `https://www.okx.com/api/v5/public/instruments` and fails with a proxy 403
   in any sandboxed environment. It is not a regression — it fails identically
   on a clean checkout — but it means `pytest` is not green offline.

(Item 3's old entry — a stale `OrderPanel.tsx` reference in
`services/schemas.ts` — was fixed in `v1.9.0`, which rewrote that comment.
`.codex/` no longer exists in the working tree.)

---

## Safety

**There are live OKX credentials on this instance, with `mode=live`
available.** Never place, modify, or cancel a real order. Use `mode=demo` for
anything exercising order flow.

Reading live account state is fine — `GET /api/positions`, `/orders`,
`/account` are all read-only and were used freely during debugging.
