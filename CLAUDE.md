# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this
repository.

This repo's documentation is agent-agnostic and lives outside this file, so that Claude,
ChatGPT, and any future AI agent work from the same source of truth instead of per-account
memory:

- **[AGENTS.md](AGENTS.md)** — how to work in this repo: dev commands, local dev vs. Docker,
  process hygiene, release process, and constraints on what not to change without approval.
- **[docs/PROJECT-CONTEXT.md](docs/PROJECT-CONTEXT.md)** — what this project is, its
  provenance, current goals, implementation state, and known limitations.
- **[docs/architecture/OVERVIEW.md](docs/architecture/OVERVIEW.md)** — how the codebase is
  actually built (the facade/demo-engine split, chart plugin architecture, data flow, state).
- **[docs/decisions/](docs/decisions/)** — key technical/product decisions already made, why,
  and what future work should not casually reverse.
- **[docs/components/COMPONENTS.md](docs/components/COMPONENTS.md)** — full UI component
  reference with screenshots, including what's unreachable/dead in the current build.
- **[docs/releases/1.5.0-large-order-book.md](docs/releases/1.5.0-large-order-book.md)** —
  implementation, operational, and verification handoff for the current Large Order Book release.

Read `AGENTS.md` first for any task in this repo. There is currently nothing Claude-Code-specific
beyond what's in `AGENTS.md` — this file exists as the pointer Claude Code loads automatically.
