# AGENTS.md

Instructions for any AI coding agent (Claude, ChatGPT, or otherwise) working
in this repository. This file covers *how* to work here. For *what this
project is*, see [docs/PROJECT-CONTEXT.md](docs/PROJECT-CONTEXT.md). For
*how the code is built*, see
[docs/architecture/OVERVIEW.md](docs/architecture/OVERVIEW.md). For
*decisions you should not casually reverse*, see [docs/decisions/](docs/decisions/).

## Stable Development Baseline

- `v1.6.0` is the current verified stable baseline on `main`.
- All new work starts from a fully synced `main`
  (`git checkout main && git pull --ff-only origin main`).
- Do not develop directly on `main` — every change goes on a dedicated branch.
- Do not change stable behavior outside the agreed scope of the current task.

## Development Workflow

Follow this sequence for any non-trivial change:

1. **Inspect before changing** — understand the existing code, architecture,
   and patterns first. Don't invent a new abstraction before checking whether
   the project already has a suitable one.
2. **Define scope** — before implementing, write down what changes, what
   doesn't, and how you'll know the task is done.
3. **Dedicated branch** — new work happens on its own branch, never directly
   on `main`.
4. **Smallest correct change** — prefer the smallest correct fix. Don't do
   general cleanup/refactor/modernization "while you're in there." If you
   spot an unrelated problem, report it separately instead of fixing it
   inline.
5. **Verification proportional to risk** — match verification depth to the
   kind of change:
   - UI/styling: relevant tests, build, visual verification.
   - Backend/API: relevant tests, API smoke test.
   - Trading logic: tests, input/behavior validation — verification must
     never place an unintended real trade.
   - Data/persistence: tests, migration/data-integrity verification where
     relevant.
   - Infrastructure/Docker: build, health check, smoke test.
   - Refactor: prove behavior preservation, relevant tests, Sonar/static
     analysis where useful.
   - Security/auth: deeper verification proportional to the risk.

   Rule of thumb: **don't run a full release audit for a small UI change** —
   but don't settle for a shallow check on a high-risk change either.
6. **Diff review before commit** — check the full diff for unrelated
   changes, secrets, generated/temp files, accidental regressions, and files
   outside the agreed scope.
7. **Commit only after verification** — commit/push only once the relevant
   checks pass. If verification fails, don't hide it or work around it.
8. **Pull request** — push the branch and open a PR into `main`. Never merge
   directly into `main`.
9. **After merge** — run a short verification on `main`, scaled to the kind
   and risk of the change.

## Development commands

```bash
npm run dev              # Vite dev server (localhost:5173, hot reload)
npm run build             # production build to dist/ (Vite only — does NOT typecheck)
npm run preview           # serve the production build locally
npm run typecheck         # tsc --noEmit (run separately from build; see docs/architecture/OVERVIEW.md)
npm run test               # vitest run — full suite
npm run test:watch         # vitest watch mode
npx vitest run src/__tests__/utils.test.ts   # single test file
```

`npm run lint` is defined (`eslint src/`) but there is no ESLint config file
in the repo — it fails immediately with "ESLint couldn't find a
configuration file." Don't rely on it until a config is added.

### Backend (`backend/`)

```bash
cd backend
pip install -e ".[dev]"                        # first time / after pyproject.toml changes
alembic upgrade head                            # apply DB migrations (needs DATABASE_URL — see below)
uvicorn app.main:app --reload --port 3000       # dev server, hot reload
pytest                                          # full backend test suite
pytest tests/test_timeframes.py                 # single test file
```

The backend needs three env vars set (see `.env.example`): `DATABASE_URL`
(a Postgres instance), `CREDENTIAL_ENCRYPTION_KEY` (Fernet key, encrypts
exchange API credentials at rest), and `JWT_SECRET` (signs access tokens).
`tests/conftest.py` sets safe defaults for these at import time so `pytest`
runs standalone without a real Postgres — but running the server for real
(`uvicorn`) needs a live Postgres reachable at `DATABASE_URL`, and needs
migrations applied first (`alembic upgrade head`).

**`CREDENTIAL_ENCRYPTION_KEY` must never change after go-live outside a
planned key-rotation event.** It encrypts every stored exchange API
credential (`backend/app/security/encryption.py`); there is no re-encryption
tooling, so changing it — intentionally or via a mistaken `.env` edit — makes
every stored credential permanently undecryptable for every user.

`POST /api/auth/login` and `/register` are rate-limited (see
`backend/app/auth/rate_limit.py`) — an in-memory sliding window, since the
backend runs as a single uvicorn worker. `/login` is limited two ways at
once: per client IP (5/60s) and per attempted account, keyed on the
normalized (lowercased/trimmed) email (8/60s) — so neither one IP hammering
many accounts nor many IPs hammering one account gets an unlimited attempt
budget. `/register` is limited per IP only (3/60s). Over the limit returns
`429` with a `Retry-After` header; the response never reveals whether the
attempted email exists.

**The backend's `:3000` is bound to the host's loopback only
(`127.0.0.1:3000:3000`)** — not exposed to the public internet — but
requests can still arrive two ways within that boundary: proxied through
nginx (which sets `X-Forwarded-For`, see `nginx.conf` and its `8080:80`
mapping), or hit directly on `127.0.0.1:3000` from the host, or by another
container addressing `backend:3000` on the Docker network, bypassing nginx
either way. The rate limiter only trusts `X-Forwarded-For` when the TCP peer
itself is a private-network address (`_is_trusted_proxy_peer` in
`rate_limit.py`) and falls back to the raw socket peer otherwise — see that
file's comment for what this does and doesn't cover.

**`npm run dev` alone is not sufficient for a working terminal.** The Vite
dev server's `/api` and `/ws` proxies target `localhost:3000` — if the
backend isn't running (or its Postgres/migrations aren't set up), requests
fail and the app can't authenticate, load market data, or trade. Run
Postgres + the backend + the frontend together for local dev; see
[Quick start in README.md](README.md#quick-start).

## Local dev vs. Docker

- **Regular code changes** (`.tsx`, `.ts`, `.py`, styling, component edits) →
  use `npm run dev` / `uvicorn --reload` (see above). Save the file, see it
  reflected immediately via hot reload. **Do not rebuild Docker images for
  these.**
- **Docker rebuild** is only needed when `Dockerfile`, `backend/Dockerfile`,
  `nginx.conf`, dependency/package files (`package*.json`,
  `backend/pyproject.toml`), migrations (`backend/alembic/versions/`), or
  build configuration (`vite.config.ts`, etc.) change.
- `docker compose up --build` runs four services together: `postgres`
  (internal only, not published to the host), `backend` (bound to
  `127.0.0.1:3000` on the host — local-only, not reachable from outside the
  machine — runs `alembic upgrade head` automatically on container start via
  `backend/docker-entrypoint.sh` before starting uvicorn), `frontend`
  (nginx on `:8080`, serving the static build and reverse-proxying
  `/api`/`/ws` to `backend` per `nginx.conf`), and `etf-scraper` (no
  published port — backfills/keeps `etf_flows` current against the same
  Postgres, see `scraper/`). Needs `CREDENTIAL_ENCRYPTION_KEY`, `JWT_SECRET`,
  and `POSTGRES_PASSWORD` in a root `.env` file (see `.env.example`) —
  compose fails fast with a clear error if any of the three is unset; there
  is no built-in default for the Postgres password. Neither the backend nor
  frontend container has a volume mount — both are static builds baked in at
  image-build time, so **there is no hot-reload inside either container**;
  they can't substitute for `npm run dev` / `uvicorn --reload` during
  iteration.
- `backend/Dockerfile` is a multi-stage build: a `builder` stage installs
  `build-essential` (needed to compile `cryptofeed`'s `yapic.json` C++
  extension) and the Python package, and the runtime stage copies only the
  installed packages plus `alembic/`, `alembic.ini`, and
  `docker-entrypoint.sh` — don't collapse this back into a single stage
  without keeping a C++ toolchain available at install time.
- `backend/Dockerfile` and `scraper/Dockerfile` both `pip install --constraint
  requirements-lock.txt` instead of a bare `pip install .` — pins every
  resolved version to that file so the build doesn't quietly resolve a
  different dependency set on a later build. Neither `pyproject.toml` changed
  (still loose `>=` ranges — no new package-manager workflow, still plain
  `pip install -e ".[dev]"` for local dev) — the lock file only constrains
  what the Docker build resolves. Regenerate it after a deliberate dependency
  bump (see the comment at the top of each `requirements-lock.txt`); it's not
  meant to be hand-edited.

## Backups & recovery

`scripts/backup-postgres.sh` / `scripts/restore-postgres.sh` — `pg_dump`/
`pg_restore` against the docker-compose `postgres` service, no credentials
embedded in either script. See
[docs/operations/backup-restore.md](docs/operations/backup-restore.md) for
usage, the Postgres volume location, and why the "obvious" rollback (`git
checkout` an older tag against a live volume) doesn't work on its own.

## Frontend data freshness

- `useMarketDataHealth()` polls `GET /api/market-data/health` every 5s; the
  stale-data banner (`ConnectionIndicator.tsx`) treats a per-exchange
  `connected: false`, or a connected exchange with no event in the last 30s,
  as degraded — matching the backend's actual per-exchange response shape
  (`{binance: {connected, lastEventAt}, okx: {...}}`).
- `useAccount()` polls every 15s (`refetchInterval`, matching `usePositions`/
  `useOrders`) — there's no WS push for balance/equity, so without polling
  the displayed balance can go silently stale between trades.

## Process/port hygiene

- Don't leave stray dev-server processes running after you're done with
  them.
- Don't open a new dev server speculatively "just in case." If you're unsure
  whether one is already running, check first (`ps aux`, `ss -tlnp`, or the
  project's own port) before starting another.

## Treat architecture docs as a starting point, not ground truth

File structure, line counts, and hook/component lists in
[docs/architecture/OVERVIEW.md](docs/architecture/OVERVIEW.md) and
[docs/components/COMPONENTS.md](docs/components/COMPONENTS.md) drift as the
code changes. Before relying on an implementation-specific detail from those
docs (an exact line count, whether a function is still called, a file's
current responsibility), verify it against the live code rather than trusting
the doc at face value.

## Release process

This repo follows a strict commit → changelog → tag → release cadence — see
[docs/decisions/0002-tag-immutability-release-process.md](docs/decisions/0002-tag-immutability-release-process.md)
for the full rules and the incident that motivated them. In short: a
completed change gets a `package.json` version bump, a `CHANGELOG.md` entry,
a **new** annotated git tag (tags are never moved or deleted), and a
`gh release create` for that tag.

## Constraints — do not change without approval

- `services/api.ts`, `services/ws.ts`, `services/api/market-data.ts`,
  `services/api/request.ts`, and `services/schemas.ts` are the live
  integration seam between the UI and the real backend (auth, market data,
  OKX trading). Don't delete or substantially simplify them — see
  [docs/decisions/0003](docs/decisions/0003-protected-backend-integration-seams.md)
  (now historical, but explains why this seam is shaped the way it is).
- `services/demo/*` **no longer exists** — it was deleted in Phase 4 along
  with the paper-trading engine, the replay feature, and the dead
  `services/api/{auth,journal,accounts}.ts` wrappers. If you see a reference
  to any of these in an older doc or comment, the doc is stale — file/fix it,
  don't assume the code still exists.
- The remaining PropSim-leftover cleanup candidates in
  [docs/PROJECT-CONTEXT.md](docs/PROJECT-CONTEXT.md) (dead `queries.ts`
  hooks, `AiTraderPage.tsx`, `useTraderPreferences.ts`'s dead
  `getPreferences`/`savePreferences` calls) are pre-approved in principle but
  **unscheduled** — confirm scope with the project owner before acting on it.
- Never move or force-delete an existing git tag (see release process
  above).
- `README.md`, `package.json`'s `name` field, and `LICENSE` are known to be
  inconsistent with the private-product rebrand (see
  [docs/decisions/0001-private-fork-no-upstream.md](docs/decisions/0001-private-fork-no-upstream.md)).
  This is deliberately deferred — don't "fix" it as a side effect of an
  unrelated task.
- OKX conditional/algo orders (STOP orders, take-profit/stop-loss, amending a
  pending order) are **intentionally disabled** in the UI, not just
  unimplemented — see `OrderPanel.tsx`/`MobileTradingPanel.tsx`/
  `OrderModifyDialog.tsx`/`PositionModifyDialog.tsx`. Don't silently "finish"
  these without discussing the OKX algo-order integration first; a
  half-wired TP/SL that doesn't actually protect a position is a real safety
  issue, not a cosmetic gap.
