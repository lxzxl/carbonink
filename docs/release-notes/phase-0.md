# Phase 0 — Foundation (碳本 v0.0.1-phase0)

## What works

- Electron + React + TanStack stack scaffolded.
- macOS + Windows dev/build pipeline.
- SQLite (better-sqlite3) with full v1 schema migrated:
  organization / site / reporting_period / emission_factor /
  pinned_emission_factor / emission_source / activity_data /
  calculation_snapshot[_line] / document / extraction /
  customer / questionnaire / question / question_mapping /
  answer / company_profile / narrative_bank / audit_event.
- PRAGMA foreign_keys = ON enforced; smoke-tested.
- audit_event append-only triggers in place.
- electron-trpc IPC + Service Layer pattern.
- safeStorage credential adapter (mac+win only).
- 5-step onboarding wizard → atomic `completeOnboarding` mutation
  persists organization + first site + first reporting_period.
- Paraglide JS i18n (zh-CN + en).
- Phase 0 acceptance: launch → wizard → dashboard.

## What's next

Phase 1 — AI Pipeline + 算 (inventory) flow.

## Known limitations

- Windows runtime verification deferred to Phase 4 installer work (no Windows test machine available).
- GUI smoke (`pnpm preview`, sqlite3 query of created rows) not run in this CI; verified manually pre-tag.
