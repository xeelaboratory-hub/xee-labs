# AGENTS.md

Instructions for any AI coding agent (Claude, ChatGPT, or otherwise) working
in this repository. This file covers *how* to work here. For *what this
project is*, see [docs/PROJECT-CONTEXT.md](docs/PROJECT-CONTEXT.md). For
*how the code is built*, see
[docs/architecture/OVERVIEW.md](docs/architecture/OVERVIEW.md). For
*decisions you should not casually reverse*, see [docs/decisions/](docs/decisions/).

## Development commands

```bash
npm run dev              # Vite dev server (localhost:5173, hot reload)
npm run build             # production build to dist/ (Vite only — does NOT typecheck)
npm run preview           # serve the production build locally
npm run typecheck         # tsc --noEmit (run separately from build; see docs/architecture/OVERVIEW.md)
npm run test               # vitest run — full suite
npm run test:watch         # vitest watch mode
npx vitest run src/__tests__/utils.test.ts   # single test file
node scripts/fetch-demo-data.mjs             # refresh bundled demo OHLC from Binance klines (no API key)
```

`npm run lint` is defined (`eslint src/`) but there is no ESLint config file
in the repo — it fails immediately with "ESLint couldn't find a
configuration file." Don't rely on it until a config is added.

### Backend (`backend/`)

```bash
cd backend
pip install -e ".[dev]"                        # first time / after pyproject.toml changes
uvicorn app.main:app --reload --port 3000       # dev server, hot reload
pytest                                          # full backend test suite
pytest tests/test_timeframes.py                 # single test file
```

**`npm run dev` alone is not sufficient for real market data.** Since the
frontend cutover (`services/api.ts`/`services/ws.ts` now call the real
backend for symbols/candles/ticks), the Vite dev server's `/api` and `/ws`
proxies target `localhost:3000` — if the backend isn't running, those
requests fail (`ECONNREFUSED`) and the terminal shows no market data. Run
both processes together for local dev; see
[Quick start in README.md](README.md#quick-start).

## Local dev vs. Docker

- **Regular code changes** (`.tsx`, `.ts`, `.py`, styling, component edits) →
  use `npm run dev` / `uvicorn --reload` (see above). Save the file, see it
  reflected immediately via hot reload. **Do not rebuild Docker images for
  these.**
- **Docker rebuild** is only needed when `Dockerfile`, `backend/Dockerfile`,
  `nginx.conf`, dependency/package files (`package*.json`,
  `backend/pyproject.toml`), or build configuration (`vite.config.ts`, etc.)
  change.
- `docker compose up --build` runs both services together: `backend`
  (published on `:3000`) and `frontend` (nginx on `:8080`, serving the static
  build and reverse-proxying `/api`/`/ws` to `backend` per `nginx.conf`).
  Neither container has a volume mount — both are static builds baked in at
  image-build time, so **there is no hot-reload inside either container**;
  they can't substitute for `npm run dev` / `uvicorn --reload` during
  iteration.
- `backend/Dockerfile` is a multi-stage build: a `builder` stage installs
  `build-essential` (needed to compile `cryptofeed`'s `yapic.json` C++
  extension) and the Python package, and the runtime stage copies only the
  installed packages — don't collapse this back into a single stage without
  keeping a C++ toolchain available at install time.

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

- Do not delete or substantially simplify the files/directories listed as
  protected in
  [docs/decisions/0003-protected-backend-integration-seams.md](docs/decisions/0003-protected-backend-integration-seams.md),
  even if they appear unused by a quick grep. Note: `services/api.ts`,
  `services/ws.ts`, and `services/api/market-data.ts` are no longer merely
  "kept for later" — the real backend integration that doc anticipated has
  happened (see its status note), and these files are now live, call-site-
  reachable code.
- `services/demo/*` is still intentionally kept (paper trading is fed real
  prices but still runs on the demo engine; the demo layer is also the
  offline/local-dev fallback for everything else) — its planned removal is a
  separate, not-yet-scheduled step. Don't delete it as part of unrelated
  cleanup without confirming that step has actually been approved.
- The broader PropSim-leftover cleanup candidate list in
  [docs/PROJECT-CONTEXT.md](docs/PROJECT-CONTEXT.md) is pre-approved in
  principle but **unscheduled** — confirm scope with the project owner
  before acting on it, don't treat its presence in this doc as a standing
  instruction to go delete it.
- Never move or force-delete an existing git tag (see release process
  above).
- `README.md`, `package.json`'s `name` field, and `LICENSE` are known to be
  inconsistent with the private-product rebrand (see
  [docs/decisions/0001-private-fork-no-upstream.md](docs/decisions/0001-private-fork-no-upstream.md)).
  This is deliberately deferred — don't "fix" it as a side effect of an
  unrelated task.
