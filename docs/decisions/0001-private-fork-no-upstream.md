# 0001 — Private fork, no upstream relationship

## Status

Decided.

## Context

This repository started as a clone of the public, open-source `OpenCharts`
trading-terminal project (`dylanpersonguy/OpenCharts` on GitHub). It has
since been rebranded in-app as **Xee.Labs** and is being developed as the
owner's own private product.

## Decision

- The `origin` remote is repointed to a private repository the owner
  controls: `https://github.com/xeelaboratory-hub/xee-labs`.
- The connection to the original `dylanpersonguy/OpenCharts` upstream was
  deliberately dropped — there is no `upstream` remote, and no intent to
  contribute changes back to the original project.
- App-facing strings, comments, and branding have been renamed from
  "OpenCharts" to "Xee.Labs" (see `CHANGELOG.md` v1.0.2–v1.0.3 for the
  specific files touched).

## Consequences

- Agents should treat this repo as a standalone private product, not as a
  fork tracking an upstream. Do not add an `upstream` remote or frame
  changes as contributions to `dylanpersonguy/OpenCharts`.
- `README.md`, `package.json` (`"name": "opencharts"`), and `LICENSE`
  (`Copyright (c) 2024 OpenCharts Contributors`) still reflect the
  project's open-source origin and have **not** been updated to match this
  decision. This is a known, deliberately deferred inconsistency — it will
  be handled in a separate rebrand-cleanup pass, not incidentally by an
  agent working on an unrelated task.
