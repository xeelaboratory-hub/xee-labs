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

*Volatile — verify rather than trust. Accurate as of 2026-08-21, `v1.8.1`.*

`main` is green on every gate:

```bash
npm run typecheck                 # 0 errors
npm run lint                      # 0 problems
npm run test                      # 143 passed
cd backend && pytest              # 136 passed, 4 skipped
```

The environment is already running — check before starting anything, per the
port hygiene rules in AGENTS.md:

- `docker compose`: `postgres`, `backend` (127.0.0.1:3000), `frontend` (:8080),
  `etf-scraper`
- Vite dev server on :5173

`v1.6.2` through `v1.8.1` all shipped on 2026-08-21. The chain worth reading
before touching the feed layer is **`v1.6.5` → `v1.7.2`**: four releases
chasing one mispricing bug to its root, a WebSocket that dropped and was never
reconnected. Two of those releases were corrections of the previous one.

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
3. **`src/services/schemas.ts:128` references `OrderPanel.tsx`**, deleted when
   `PositionBuilderPanel` absorbed order placement.
4. **`AiTraderPage.tsx` and `useTraderPreferences.ts`** are still dead.
5. **`.codex/`** sits untracked in the working tree. It was not created by the
   previous session and was deliberately left alone.

---

## Safety

**There are live OKX credentials on this instance, with `mode=live`
available.** Never place, modify, or cancel a real order. Use `mode=demo` for
anything exercising order flow.

Reading live account state is fine — `GET /api/positions`, `/orders`,
`/account` are all read-only and were used freely during debugging.
