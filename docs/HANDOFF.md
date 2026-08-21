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

**`docker compose up -d --build <service>` also rebuilds that service's
dependencies.** Naming one service does not scope the build to it: `--build
frontend` rebuilds `backend` too, because `frontend` depends on it — and it
rebuilds it *from the current working tree*, whatever branch that happens to
be. This is the exact inverse of the trap above, and it is the more dangerous
one: there the container kept code you thought you had replaced, here it
quietly replaced code you thought was running.

It has already cost real damage. The backend had been built from a branch
carrying a security fix; a later `--build frontend` from `main` silently
reverted it, and the next check — written expecting the fix to still be
there — created a live account in the database rather than being refused.

Two habits close it: build each service from the branch you mean
(`up -d --build backend frontend` names both explicitly), and after any
rebuild, ask the container what it is running rather than assuming —
`docker compose exec backend python -c "from app import config; print(...)"`
answers in one line and would have caught it before the write.

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

**There is no OKX demo credential on this instance.** `exchange_credentials`
holds one row and it is `is_demo = false`. Every `mode=demo` call therefore
404s with "no OKX demo credentials configured" — which looks like a code fault
and is not one. Since live order placement is off limits here, the practical
consequence is that **no order round-trip can be verified on this box at all**
until demo API keys are added. Read paths (`/account`, `/orders`, the
`by-client-id` lookup) work fine against `mode=live` and place nothing.

**A number that renders correctly can still be wrong.** A volume profile level
displayed as `76,451.67` while writing `76451.67166666666` into the order
field. Reading the DOM, not the screenshot, is what caught it.

---

## State at handoff

*Volatile — verify rather than trust. Accurate as of 2026-08-21, `v1.10.0`.*

`main` is green on every gate:

```bash
npm run typecheck                 # 0 errors
npm run lint                      # 0 problems
npm run test                      # 184 passed
cd backend && pytest              # 192 passed, 4 skipped
```

`pytest` shows one extra failure in any environment without outbound network
access — open item 6 below, a test that makes a live call to `www.okx.com`.
On a machine with egress (the author's) the suite is fully green; it fails
identically on a clean checkout everywhere else.

Whether the environment is already running depends on where you picked this
up. On the author's machine it usually is; a fresh cloud container has
nothing running and no Docker daemon, and needs `npm ci` before the frontend
gates will even start. Check before starting anything, per the port hygiene
rules in AGENTS.md:

- `docker compose`: `postgres`, `backend` (127.0.0.1:3000), `frontend` (:8080),
  `etf-scraper`
- Vite dev server on :5173

**The owner reaches the terminal from a phone over Tailscale**, which is set
up in a way worth knowing before you debug it. Tailscale was installed
*without root* — a static build under `~/.local/bin`, with the daemon in
`--tun=userspace-networking` mode against `~/.tailscale/`. Two consequences
follow. There is no systemd unit, so **nothing restarts it after a reboot**;
it has to be launched by hand. And because userspace mode creates no network
interface, the machine cannot reach its own tailnet address — a `curl` to it
from here returns nothing, which looks like a broken tunnel and is not.
Inbound traffic arrives through `tailscale serve --http=80 8080`, which
proxies to the frontend container; the only real test is from another device
on the tailnet.

`v1.6.2` through `v1.10.0` all shipped on 2026-08-21. The chain worth reading
before touching the feed layer is **`v1.6.5` → `v1.7.2`**: four releases
chasing one mispricing bug to its root, a WebSocket that dropped and was never
reconnected. Two of those releases were corrections of the previous one.

**`v1.9.0` and `v1.10.0` were both verified against tests only** as far as
order *placement* goes. Before trusting the attached bracket or the client
order id in the terminal, place one `mode=demo` order from the Position
Builder and confirm the stop, the target, and the `clOrdId` appear on the OKX
side. That is currently blocked: there is no demo credential on this instance
(see the trap above), so it needs demo API keys first. Per the first trap,
rebuild the backend image (`docker compose up -d --build backend`) rather
than restarting it.

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
5. **The write half of order idempotency is untested against an exchange.**
   `v1.10.0` sends `clOrdId` and recovers a duplicate, but with no demo
   credential here (see the trap above) neither path has been through OKX.
   The read half — the `by-client-id` lookup and its 404 — was verified live.
6. **`backend/tests/test_large_order_book.py` makes a live network call.**
   `test_okx_subscribes_only_to_the_connections_filtered_channels` reaches
   `https://www.okx.com/api/v5/public/instruments` and fails with a proxy 403
   in any sandboxed environment. It is not a regression — it fails identically
   on a clean checkout — but it means `pytest` is not green offline.

(Item 3's old entry — a stale `OrderPanel.tsx` reference in
`services/schemas.ts` — was fixed in `v1.9.0`, which rewrote that comment.
The tag gap that stood here is closed: `v1.9.0` and `v1.10.0` were both tagged
and released on 2026-08-21, after sitting bumped-but-untagged.)

---

## Safety

**There are live OKX credentials on this instance, with `mode=live`
available.** Never place, modify, or cancel a real order. Use `mode=demo` for
anything exercising order flow.

Reading live account state is fine — `GET /api/positions`, `/orders`,
`/account` are all read-only and were used freely during debugging.
