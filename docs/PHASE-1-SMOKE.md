# Phase 1 Smoke — 2026-05-14

This document records the results of the automated portion of the consolidated Phase 1 smoke before tagging `phase-1d`. The GUI portion (uploading 5 real PDFs through the Electron Confirm flow) is still owed; this file is the closest-to-production verification we could run from the CI surface.

## What was exercised

### 1. Production build (`pnpm build`)

```
out/main/index.cjs             154.77 kB
out/preload/index.cjs            2.42 kB
out/renderer/assets/*.css       29.82 kB
out/renderer/assets/*.js     1,371.84 kB
```

- 2334 modules transformed in the renderer bundle.
- Paraglide compilation completed; all 5 new `ef_matcher_*` i18n keys resolved.
- No missing-import, no missing-asset, no TypeScript errors at build time.

### 2. Full test suite (`pnpm vitest run --pool=threads`)

**415 tests / 57 files passing.** Breakdown by stage:

| Layer | Tests added in Phase 1 | Files |
|---|---|---|
| Stage schemas (5 stages × ~14 tests) | ~70 | `tests/main/llm/stages/*.test.ts` |
| Stage registry | 7 | `tests/main/llm/stages/registry.test.ts` |
| Extraction service smokes (1 per stage) | 5 | `tests/main/services/extraction-service.test.ts` |
| FTS5 migration + triggers | 5 | `tests/main/db/migrations/010_ef_fts.test.ts` |
| Seed v2 EFs | 5 | `tests/main/db/migrations/011_seed_v2.test.ts` |
| Per-stage hint extractor | 7 | `tests/main/services/ef-matcher/hint.test.ts` |
| LLM `recommendEfs` | 1 | `tests/main/llm/llm-client-recommend.test.ts` |
| `EfMatcherService` (mocked candidates) | 4 | `tests/main/services/ef-matcher-service.test.ts` |
| `EfMatcherService` (real seeded DB, mocked LLM) | 6 | `tests/main/services/ef-matcher-service-smoke.test.ts` |
| `ef:recommend` IPC handler | 3 | `tests/main/ipc/ef-matcher-handlers.test.ts` |
| ActivityForm "Recommended" UX | 3 | `tests/renderer/activity-form-matcher.test.tsx` |

### 3. Real-DB matcher smoke (`ef-matcher-service-smoke.test.ts`)

Six end-to-end scenarios exercising the FULL backend pipeline (real seeded EF catalog, real FTS5 indexing, real bm25 ranking, real `EfService.list` filter), mocking only the upstream extraction/source rows and the LLM call:

| # | Stage | Scenario | Result |
|---|---|---|---|
| 1 | `fuel_receipt.v1` | hint `fuel_type='柴油' fuel_category='diesel'` over `category='fuel.mobile'` | Diesel EF ranks first in `ranked_full`; LLM picks the top 3 |
| 2 | `freight.v1` | hint `mode=road, vehicle_class=重型卡车, supplier=顺丰` over `category='freight.road'` | All 4 candidates are `freight.road.*`; recommendations resolved |
| 3 | `travel.v1` | hint `mode=air, travel_class=经济舱` over `category='travel.air.economy.shorthaul'` | Travel air EF surfaces; recommendation resolves |
| 4 | `purchase.v1` | hint `category=service, item_description=咨询服务` over `category='purchase.service.consulting'` | CNY-priced consulting EF surfaces with `input_unit='CNY'` |
| 5 | empty catalog | source category doesn't exist | Returns `{recommended:[], ranked_full:[]}` immediately; LLM never called |
| 6 | cache | same `(extraction_id, source_id)` twice | LLM invoked exactly once |

## Findings

### 🟢 No regressions

All pre-existing tests (extraction stages 1-5, stage registry, IPC, renderer) continue to pass. The opt-in `matcherHint` design preserves every prior code path.

### ✅ Category granularity mismatch — RESOLVED (commit 954cc7d)

The smoke test surfaced a real product-level wrinkle: the canonical `emission_source.category` (chosen once by the user when creating a source) is more coarse than the EF catalog's per-row `category` (which goes down to per-class granularity like `travel.air.economy.shorthaul`). The matcher previously used `EfService.list({scope, category?})` with **exact** category match, so a source categorized `travel.air` got zero candidates.

Concrete examples observed in the seed:
- `travel.air.economy.shorthaul` / `travel.air.economy.longhaul` / `travel.air.business.longhaul` are three sibling categories — no parent `travel.air` bucket.
- `purchase.service.consulting` exists; users would more naturally name their source `purchase.service` or just `purchase`.

**Fix:** `EfService.list({category})` now does prefix-match (`category = ? OR category LIKE '<cat>.%'`). A source categorized `travel.air` pulls in all three `travel.air.*` EFs; `travel` pulls in all 6 `travel.*` rows. Exact-match behavior is preserved for fine-grained categories.

The smoke test `travel.v1` stage now uses the coarser `category: 'travel.air'` to exercise the bridge; see `tests/main/services/ef-service.test.ts` for the three new unit tests covering coarse/fine/top-level prefix match.

### Open follow-up for the GUI smoke

The automated layer cannot exercise:

- The actual Electron renderer lifecycle (preload IPC bridge, `window.api.invoke` against the real main process).
- Real PDF → vision extraction → review-page Confirm-flow E2E.
- The LLM call against a real OpenAI key.
- Visual verification of the "Recommended for this document" star + reasoning layout.

To complete `phase-1d`:

```bash
cd /Users/lxz/ws/personal/carbonink
pnpm dev
```

Then for each of the 5 stages, upload a representative PDF, run extraction, click Confirm, and verify:

1. The "为本单据推荐" panel appears above the candidate list after picking an emission source.
2. The 3 starred recommendations have non-empty Chinese reasoning text.
3. Clicking a recommended EF sets the form's `ef_*` fields (the Submit button enables).
4. Submitting creates an `activity_data` row that appears on the dashboard.

If all 5 stages pass, tag `phase-1d`:

```bash
git tag phase-1d
git push --tags
```
