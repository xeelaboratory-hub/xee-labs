# 0003 — Protected backend-integration seams

## Status

Decided.

## Context

This repo is three stacked apps by history (see
[PROJECT-CONTEXT.md](../PROJECT-CONTEXT.md) for the full provenance): an
original full-stack Next.js/Express app, wiped and replaced by a Vite/React
terminal fork ("PropSim"), now rebranded as Xee.Labs. The PropSim fork
brought its entire client-side API surface with it, and a large amount of it
has zero UI consumers in this build — `services/queries.ts` alone exports
dozens of hooks (leaderboards, competitions, certificates, AI-trader plans,
bot integrations, push notifications, MFA, scaling plans, profit-split,
account merge, …) that resolve to no-ops because `services/api.ts` wraps the
demo layer in a `Proxy` whose fallback silently no-ops anything
`services/demo/api.ts` doesn't implement.

A grep-based "what's unused" pass would flag a lot of this surface as dead
code. Some of it genuinely is. Some of it is deliberately-kept groundwork for
the project's stated future goal of connecting a real backend/API.

## Decision

The following are **explicitly protected** — they must not be deleted or
substantially simplified as part of a "clean up dead code" task, regardless
of how unused they look from a quick grep of current call sites:

- `services/api/request.ts` — a working, typed HTTP client (bearer auth,
  single-flight token refresh, timeout, Zod error unwrapping). Reuse as-is
  when a real backend is connected.
- `services/api/accounts.ts`, `services/api/chart-templates.ts` —
  partially/fully live already.
- `services/api.ts` / `services/ws.ts` — these are the actual swap point for
  a real backend. Don't delete; replace their internals when that happens.
- `services/schemas.ts` — the shared Zod type contract a real backend and
  the demo engine already agree on.
- `services/demo/*` in general — worth keeping even after a real backend
  exists, as a local-dev/offline demo mode. This mirrors the project's own
  stated design philosophy of swapping `api.ts`/`ws.ts` while leaving the UI
  untouched.

This is distinct from the broader, currently-unscheduled cleanup candidate
list (unused `queries.ts` hooks, `AiTraderPage.tsx`, unused `services/api/*`
wrappers like `auth.ts`/`market-data.ts`/`journal.ts`, the `REPLAY_ENABLED`
feature) — see [PROJECT-CONTEXT.md](../PROJECT-CONTEXT.md) → "Known
limitations / TODO". That list is pre-approved-but-not-actioned; the list in
this document is protected regardless of approval status.

## Consequences

- An agent asked to "remove dead/unused code" in this repo must exclude the
  protected list above, and should confirm scope before touching anything on
  the broader cleanup-candidate list even though it's pre-approved.
- If a real backend integration is undertaken, start from `services/api.ts`,
  `services/ws.ts`, and `services/schemas.ts` as the seam, and reuse
  `services/api/request.ts` rather than writing a new HTTP client.
