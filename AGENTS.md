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
node scripts/fetch-demo-data.mjs             # refresh bundled OHLC from Binance klines (no API key)
```

`npm run lint` is defined (`eslint src/`) but there is no ESLint config file
in the repo — it fails immediately with "ESLint couldn't find a
configuration file." Don't rely on it until a config is added.

## Local dev vs. Docker

- **Regular code changes** (`.tsx`, `.ts`, styling, component edits) → use
  `npm run dev`. Save the file, see it reflected immediately via hot reload.
  **Do not rebuild the Docker image for these.**
- **Docker rebuild** is only needed when `Dockerfile`, dependencies/package
  files, or build configuration (`vite.config.ts`, etc.) change.
- The Docker container (`Dockerfile`, multi-stage node→nginx) has no volume
  mount — it's a static build baked into the nginx image at build time.
  There is **no hot-reload inside the container** as currently configured,
  so it cannot substitute for `npm run dev` during iteration.

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
  even if they appear unused by a quick grep.
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
