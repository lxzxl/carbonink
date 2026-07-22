# Testing + i18n discipline

> Detailed reference for `AGENTS.md` → "Non-negotiables". Linked, not
> auto-loaded; the one-line rules live in AGENTS.md, the why/how is here.

## i18n

All user-facing strings go through paraglide messages (`messages/en.json`
+ `messages/zh-CN.json`). Both files must have the exact same key set —
the Phase 5 sweep includes a key-alignment check. New features add keys
to BOTH files in the same commit.

**Known exception:** the inbound supplier-disclosure UI (v2.0) shipped with
inline Chinese rather than paraglide keys, as a deliberate ship-it shortcut.
Only the two nav-label keys went through paraglide. Full migration is tracked
as a v2.1 follow-up (ROADMAP §4.5). Don't copy this pattern for new features —
it's debt, not precedent.

## Test discipline

- **vitest baseline:** 662/662 was the floor on `main` after `v1.0.0`.
  Current passing count is **1093/1093** (2026-07-22). Don't land a commit
  that drops the passing count.
- **Biome lint debt:** the pre-existing ~940 errors are documented as
  deferred to v1.0.1. Don't fix it incidentally. New code MUST lint
  clean on a scoped `biome check <changed files>` though.
- **better-sqlite3 ABI flip:** after `pnpm build` (or any script that runs
  `electron-rebuild`), vitest will fail with `NODE_MODULE_VERSION 145 vs 137`
  because better-sqlite3's native binding flipped to Electron ABI. Restore
  via the desktop package script:
  ```bash
  pnpm --filter carbonink run rebuild:node
  ```
  That runs `pnpm rebuild better-sqlite3` from the desktop workspace,
  which finds the actual installed version (currently 12.10.0; the
  earlier hand-rolled `rm node_modules/.pnpm/better-sqlite3@12.9.0/...`
  recipe went stale after the dep bump). This is environmental,
  never a regression. The inverse — `rebuild:native` — flips back to the
  Electron ABI the app + Playwright e2e need.

## Audit-event hygiene (security invariant)

When writing `audit_event` rows, the payload must NOT contain prompt
content — only tool names, IDs, counts, and decision-path flags.
`organizationId` is injected into tools server-side; it is never
user-supplied. (Carried here because it's a cross-cutting rule that's
easy to violate when adding a new audited action.)
