# 0002 — Tag immutability & release process

## Status

Decided.

## Context

Early in this project's history, git tags were moved forward on each release
(`v1.0.0` → `v1.0.1` → `v1.0.2` → `v1.0.3`, deleting the previous tag each
time) instead of creating a new tag per version. Once `CHANGELOG.md` existed
as a real release history, this was identified as actively harmful: moving a
tag destroys the ability to create a GitHub Release for the version it used
to point to, and makes past versions un-checkoutable by their tag name.

## Decision

This repo follows a strict, standing release workflow:

```
Development → Commits → Feature/Fix complete → Update CHANGELOG.md
  → New git tag (never moved or deleted) → GitHub Release
```

Specifically:

- Every commit that completes a feature/fix gets a corresponding semver
  bump (patch/minor/major depending on the nature of the change) in
  `package.json`, applied as its own `chore: bump version to X.Y.Z` commit.
- **A new annotated git tag is created per version. Existing tags are never
  moved or force-deleted.** From `v1.0.4` onward, every tag is permanent.
- `CHANGELOG.md` (Keep a Changelog format) is updated **before** tagging —
  it is the source of truth for release notes.
- After tagging, a GitHub Release is created (`gh release create vX.Y.Z`)
  using the CHANGELOG entry as the release notes body.
- `package.json`'s `version` field is the single source of truth for the
  version shown in the app UI — the `Footer` component reads it directly.
  Keep it in sync with the tag.

## Consequences

- Agents must never run `git tag -f`, delete an existing release tag, or
  force-push over a tag in this repo.
- When a task reaches a natural completion point (a feature, a fix, a batch
  of related changes), the changelog → tag → release sequence should be
  proposed or performed as part of that work, not deferred indefinitely.
- Every version from `v1.0.4` onward stays permanently checkoutable and
  has a corresponding GitHub Release.
