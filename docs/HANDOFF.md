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

**Pushing anything under `.github/workflows/` fails with the repo's normal
credentials.** GitHub refuses to let an OAuth token create or update a
workflow file without the `workflow` scope, and the CLI's token carries `repo`
but not that. The rejection happens server-side after the commit succeeds
locally, and no amount of retrying, rebasing or re-committing moves it.

Two ways through. `gh auth refresh -h github.com -s workflow` fixes it
permanently, but it is an interactive device-code flow and needs a terminal
that can print a code and wait. Failing that, split the commit: push
everything except the workflow file, and add that one file through GitHub's
web editor, which uses the account's own session rather than the CLI token.
That is how `.github/workflows/ci.yml` got here.

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

*Volatile — verify rather than trust. Accurate as of 2026-08-21, `v1.12.0`.*

`main` is green on every gate, and no longer only when someone remembers to
check: `.github/workflows/ci.yml` runs all of them on every push to `main` and
every PR into it (see AGENTS.md). A green tick on a PR means these passed.

```bash
npm run typecheck                 # 0 errors
npm run lint                      # 0 problems
npm run test                      # 210 passed
cd backend && pytest              # 212 passed, 4 skipped
```

Offline, expect exactly one failure — open item 7 below, a test that makes a
live call to `www.okx.com`. It carries a `network` marker, so CI deselects it
(`pytest -m "not network"`: 211 passed, 1 deselected) and a green build never
depends on an exchange being up. A plain `pytest` locally still runs it.

**There is no production, and the only running instance is the author's
machine.** Releases are tagged and published on GitHub, which is a versioning
act rather than a deployment one: `.github/workflows/` holds `ci.yml` and
nothing else — no deploy job, no host, no domain. What runs is docker compose
on the author's desktop, reachable at `localhost:8080`, on the LAN, and
through the Tailscale tunnel below. From a phone that arrangement reads like a
deployed product; it disappears when the machine sleeps or reboots. Say "the
running instance", not "production", and expect the question to come up again
— it is genuinely not obvious from the outside.

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

`v1.6.2` through `v1.12.0` all shipped on 2026-08-21. The chain worth reading
before touching the feed layer is **`v1.6.5` → `v1.7.2`**: four releases
chasing one mispricing bug to its root, a WebSocket that dropped and was never
reconnected. Two of those releases were corrections of the previous one.

**`v1.9.0` and `v1.10.0` were both verified against tests only** as far as
order *placement* goes. (`v1.11.0` and `v1.12.0` do not touch it.) Before trusting the attached bracket or the client
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
5. **`1-Click` sends a market order with no confirmation.** `v1.12.0` put a
   confirmation in front of *switching to* live mode, but not in front of an
   order placed once you are there. Raised with the owner on 2026-08-21 and
   **declined** — this is a recorded decision, not a gap. Don't "fix" it
   without asking again.
6. **The write half of order idempotency is untested against an exchange.**
   `v1.10.0` sends `clOrdId` and recovers a duplicate, but with no demo
   credential here (see the trap above) neither path has been through OKX.
   The read half — the `by-client-id` lookup and its 404 — was verified live.
7. **`backend/tests/test_large_order_book.py` makes a live network call.**
   `test_okx_subscribes_only_to_the_connections_filtered_channels` reaches
   `https://www.okx.com/api/v5/public/instruments` and fails with a proxy 403
   in any sandboxed environment. It is not a regression — it fails identically
   on a clean checkout. It now carries a `network` marker, so CI deselects it
   and a plain `pytest` still runs it; offline, expect that one failure and
   nothing else.
8. **CI stops at "was this green".** There are no build artifacts, no deploy
   pipeline, and nothing to roll back *to* — `.github/workflows/ci.yml` is the
   floor of the fourth blocker in
   [docs/releases/RELEASE-READINESS.md](releases/RELEASE-READINESS.md), not the
   whole of it. Two smaller gaps it names are open too: `nginx.conf` sets no
   `Cache-Control` on `index.html`, so a returning user can hold a stale one
   pointing at asset hashes that no longer exist; and `restart:` is set on
   `etf-scraper` alone, not on `backend`, `frontend` or `postgres`.
9. **`@playwright/test` is installed with no config and no specs.** The money
   path — login, order placement, cancellation, closing a position — has no
   end-to-end coverage in either suite.

Two findings from the `v1.12.0` mobile review were examined and deliberately
left, so they don't get rediscovered as bugs:

- **The phone spends ~108px on bottom chrome** (57px tab bar + 51px footer).
  Folding the footer away was measured and rejected: the toolbar has no room
  for its controls at 375px (symbol, price, timeframe and indicators already
  take ~289 of it), the theme switcher exists nowhere else, and the footer is
  where DEMO/LIVE lives — burying that contradicts the confirmation `v1.12.0`
  added in front of going live.
- **The price axis is 68px because of its label text**, not the floor that was
  lowered from 80. Reclaiming the rest means dropping decimals from
  `79600.00`, which is a precision decision on a trading chart rather than a
  layout one, and was left to the owner.

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
