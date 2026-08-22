# Release Readiness — `v1.12.0`

An audit of this codebase against the four named blockers for a first paid
release: **safe trading**, **reliable alerts**, **idempotent payment**,
**proven rollback**. It answers one question — what would have to be true
before anyone pays for this — and nothing else.

This replaces an assessment written at `v1.6.x` (PR #9, closed unmerged). Every
number in that one had gone stale: it measured 61 frontend tests where there
are now 210, 117 typecheck errors where there are now none, and reported "no
ESLint config" and "no CI" for a repo that now has both. Its *findings* aged
better than its measurements, which is why this file exists rather than a
rebase of that one.

**Scope note.** This is a readiness assessment, not a deploy plan. It says what
is missing, not how to build it.

---

## Measured baseline

Measured on 2026-08-22 against `3562902` (`main`, `v1.12.0`), on a clean
checkout — `npm ci`, then `pip install -e "backend[dev]"` into a fresh venv.
Node 22.22.2, Python 3.11.15.

| Check | Result |
| --- | --- |
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 problems |
| `npm run test` | 210 passed, 22 files |
| `npm run build` | passes — main chunk 644.03 kB (gzip 200.86 kB) |
| `pytest -m "not network"` | 211 passed, 4 skipped, 1 deselected |
| `npm audit` | 6 findings (2 critical, 1 high, 3 moderate) |
| `npm audit --omit=dev` | 0 findings |

Two things this baseline could not measure, and neither is a code fault:

- **No Docker daemon in the environment it was run in**, so nothing here was
  verified against a running stack — no container health check, no nginx
  behaviour, no end-to-end request.
- **No OKX demo credential exists on any instance** (see
  [HANDOFF](../HANDOFF.md)), so no order round-trip was exercised. This is the
  single largest gap in this document and it recurs under blocker 1.

The deselected backend test reaches `www.okx.com` and carries a `network`
marker for exactly that reason; CI deselects it so a green build never depends
on an exchange being up.

---

## Blocker 1 — Safe trading

**Met in code. Unproven against the exchange.**

The hole the first assessment found is closed. It reported that
`request()` aborts a call at 20 s while the backend keeps going, that
`place_order` sent no `clOrdId`, and that the UI's advice was to try again —
which is asking a trader to place a second order on top of a first one they
cannot see. Today every mutating order carries a caller-minted `clOrdId`
(`backend/app/exchange/okx_client.py`), and
`src/services/api/order-recovery.ts` answers "did that order go through?"
without re-sending it, keeping the three possible answers apart: it is at OKX,
OKX has no such order, or the lookup itself failed and the outcome is still
unknown.

What else holds:

- The order surface is deliberately narrow. `backend/app/api/trading.py`
  accepts `MARKET` and `LIMIT` only — there is no STOP order type, no amend
  endpoint, and no TP/SL against an existing position. A trader cannot reach a
  half-built OKX integration because those routes do not exist.
- Switching to live asks first, in money terms rather than mode names
  (`v1.12.0`), and self-service registration is closed unless explicitly opened
  (`v1.11.0`), with rate limits on the auth routes.

What does not hold:

- **The write half of idempotency has never been through OKX.** The read half —
  the `by-client-id` lookup and its 404 — was verified live. The write half
  cannot be, on any instance available today, because there is no demo
  credential. It is tested, and tests are not an exchange.
- The bracket attached at placement (`v1.9.0`) and the client order id
  (`v1.10.0`) are both in the same position: covered by tests, never observed on
  the OKX side.

**What would close it:** demo API keys, then one order placed from the Position
Builder with the stop, the target and the `clOrdId` confirmed on OKX. That is a
credential problem, not an engineering one — which makes it the cheapest of the
four blockers to finish and the only one currently blocked on something other
than work.

`1-Click` sending a market order with no confirmation is **not** counted as a
gap here. It was raised with the owner on 2026-08-21 and declined; it is a
recorded decision.

---

## Blocker 2 — Reliable alerts

**Not met. Unchanged since the first assessment.**

`src/lib/chart-plugins/drawing-tools/line-alerts.ts` is the whole of it, and
its own header is honest about what it is: when the live mid price crosses an
alert-enabled drawing, the chart fires an in-session toast and a sound. That
means in-memory, single-tab, and gone on reload. There is no alerts table (the
backend has no alert module at all), no server-side evaluator, no delivery
fan-out, and no management UI.

**Coupled to a decision that has not been made.** There is no service worker
anywhere in the repo, so the app is not installable and Web Push is impossible
on every platform. "Alerts that reach you when the app is closed" therefore
cannot be sequenced independently of the desktop form-factor question below —
they are one decision, not two.

This is the blocker with the most work left in it: it needs a schema, a
process that evaluates conditions server-side, a delivery path, and a UI, none
of which exist in any form.

---

## Blocker 3 — Idempotent payment

**Not met — but it now has a subject.**

No processor, no webhook endpoint, no entitlement concept, and nothing in the
app is gated. Payment idempotency has nothing to be idempotent *about* yet.

What changed since the first assessment is the ground under it. There is now a
real auth system — users, JWT, closed registration, four Alembic migrations —
so there is an account for an entitlement to hang off. At `v1.6.x` there was
not. The work is unstarted, but it is no longer unstartable.

The three open decisions below all have to be answered before any of it can be
scoped: what is being sold, once or monthly, and through whom.

---

## Blocker 4 — Proven rollback

**Partially met. This is where the movement has been, and it stops early.**

`.github/workflows/ci.yml` runs all four gates on every push to `main` and
every PR into it, in two jobs — frontend (typecheck, lint, test, build) and
backend (pytest, network test deselected). A green tick on a PR now means
something specific, and it does not depend on anyone remembering.

Everything past "was this commit green" is missing:

- **No artifacts, no deploy job, no environment, and nothing to roll back
  *to*.** Releases are tagged and published on GitHub, which is a versioning act
  rather than a deployment one. Tag immutability is a recorded decision
  ([0002](../decisions/0002-tag-immutability-release-process.md)), but an
  immutable tag is not a rollback target — nothing consumes it.
- **`nginx.conf` sets no `Cache-Control` on `index.html`.** A returning user can
  hold a stale index pointing at asset hashes that no longer exist. This build
  emits `index-D9IxrGZj.js`; the previous one emitted something else, and a
  cached index asking for the old name gets a 404 and a white screen. This is
  the one item here that can break a user *because* of a successful release.
- **`restart:` is set on `etf-scraper` alone.** `backend`, `frontend` and
  `postgres` have no restart policy, so a crash on any of them stays down until
  someone notices.
- **Health is honest at the container edge, not at the root.** `/api/health`
  returns 503 when Postgres is unreachable, and reports feed connectivity
  without hard-failing on it — an exchange outage is expected and recoverable,
  and the frontend's stale-data banner already covers it for users. `GET /`
  still returns `{"status": "ok"}` unconditionally; nothing depends on it any
  more, but it is a misleading thing to leave reachable.
- **Data restore has a script and no drill.** `scripts/backup-postgres.sh` and
  `restore-postgres.sh` run `pg_dump`/restore inside the postgres container over
  its local socket, so no password lands in a shell history. Neither has been
  exercised as a recovery rehearsal — an untested restore is a backup you hope
  works.

**And the honest framing:** there is no production. The only running instance is
the author's machine, reachable at `localhost:8080`, on the LAN, and through a
Tailscale tunnel that does not survive a reboot. "Proven rollback" cannot be met
against an environment that does not exist; the first real step in this blocker
is deciding where the thing runs.

---

## Test coverage over the money path

210 frontend tests and 211 passing backend tests are a real safety net for units, and
they do not touch the sequence a paying user's money moves through.

`@playwright/test` is a declared devDependency with **no config file and no
specs**. Login, order placement, cancellation and closing a position have no
end-to-end coverage in either suite — each is covered in pieces, none end to
end, and the pieces are exactly where an integration defect hides.

This is the cheapest large win available: the harness is already installed,
and the four flows above are the whole of the money path.

---

## Bundle size

The main chunk is 644.03 kB, above Vite's 500 kB warning threshold, with no
code splitting configured. It was 621 kB at the first assessment — it has grown
by ~23 kB, not shrunk. Not a blocker, but it is the number that moves in the
wrong direction on its own if nobody looks at it.

---

## Dependency vulnerabilities

`npm audit` reports 6 findings — 2 critical, 1 high, 3 moderate — all of them in
the dev toolchain (the `vite` / `vitest` / `vite-node` chain). `npm audit
--omit=dev` reports 0: nothing vulnerable ships in `dist/`. They are worth
clearing on a quiet day and are not release-blocking.

---

## Open decisions

Unanswered since the first assessment, and each one changes scope materially
enough that guessing is worse than waiting:

1. **Desktop form factor** — PWA, Electron, or notifications-only. This decides
   whether blocker 2 can deliver alerts to a closed app at all.
2. **One-time purchase or subscription** — decides what an entitlement means and
   how long it lasts.
3. **Payment processor** — decides the shape of the webhook and the idempotency
   key.

---

## Summary

| Blocker | `v1.6.x` | `v1.12.0` |
| --- | --- | --- |
| Safe trading | Partially met — timed-out order could be placed twice | Met in code; unverified against OKX for want of a demo credential |
| Reliable alerts | Not met | Not met — unchanged |
| Idempotent payment | Not met, no subject | Not met; auth now exists to attach an entitlement to |
| Proven rollback | Not met — no CI at all | CI on every push and PR; no artifacts, no deploy, no environment |

One blocker is finishable with a credential. One is unstarted and needs a
product decision first. One is unstarted and large. One has a floor and no
ceiling.
