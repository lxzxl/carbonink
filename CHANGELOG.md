# Changelog

## Phase 1d (pending tag — awaiting GUI smoke)

**Scope:** the second half of Phase 1 — adding the last 4 extraction stages on top of the `china_utility.v1` baseline shipped in `phase-1a`, refactoring the rendering surface in preparation for the EF Matcher, and shipping the EF Matcher v1 itself.

64 commits since `phase-1c`. 309 → 415 vitest tests. ExtractionReview.tsx 596 → 260 LOC.

### Extraction stages (5 total, +4 in this release)

Every stage follows the same shape: zod schema + buildPrompt (text-only) + buildVisionMessages (image-aware) + registry entry + per-stage React components in `src/renderer/components/extractions/<stage>/`. Shared `FIELD_RULES` private constants keep prompt rules DRY between the text and vision paths.

- **`fuel_receipt.v1`** — 加油票. 11 fields, 8-value `fuel_category` enum (gasoline/diesel/lpg/cng/jet_fuel/marine_fuel/biofuel/other). Prompt wrapper: `<receipt>`.
- **`freight.v1`** — 货运单/物流单. 13 fields with 4-mode discriminator (road/rail/sea/air), `vehicle_class`, free-text origin/destination, `distance_km` nullable. Prompt wrapper: `<receipt>`.
- **`purchase.v1`** — 采购发票. 9 fields with 6-value `category` enum (raw_material/component/consumable/office_supply/service/other), dual-track `quantity_kg` (numeric mass) + `amount_yuan` (currency-priced fallback). Prompt wrapper: `<invoice>`.
- **`travel.v1`** — 差旅票据. 15 fields with 3-mode discriminator (air/rail/taxi); 7 nullable fields. ActivityForm prefill is dual-track: `unit='passenger-km'` for air/rail vs `'vehicle-km'` for taxi. Prompt wrapper: `<ticket>`.

Every stage has a `tests/main/llm/stages/<stage>.test.ts` (schema + metadata) and a smoke in `tests/main/services/extraction-service.test.ts` that exercises the orchestrator's per-stage routing.

### Per-stage component split (Phase 1.5 prep)

`src/renderer/components/ExtractionReview.tsx` was a 698-LOC monolith holding all 5 stages' parsed types + `<Fields>` renderers + `build*InitialValues` builders inline. Split into:

```
src/renderer/components/
├── ExtractionReview.tsx                  (orchestrator, 260 LOC)
└── extractions/
    ├── types.ts                          (StageParsed union + parseExtraction)
    ├── shared.tsx                        (Field row + CONFIDENCE_*)
    ├── china-utility/{types,fields,prefill}
    ├── fuel-receipt/{types,fields,prefill}
    ├── freight/{types,fields,prefill}
    ├── purchase/{types,fields,prefill}
    └── travel/{types,fields,prefill}
```

Pure refactor — zero behavior change, zero test changes. Safety net: existing renderer tests + typecheck against the discriminated union.

### EF Matcher v1

The Confirm flow now overlays a "为本单据推荐" (Recommended for this document) section above the existing scope/category-filtered EF list. Implementation:

1. **Migration 010** — SQLite FTS5 virtual table `ef_fts` over `(name_zh, name_en, description_zh, description_en)` with `unicode61` tokenizer (handles English + CJK), INSERT/UPDATE/DELETE triggers keep it in sync with `emission_factor`.
2. **Migration 011** — 20 new seeded EFs covering fuel (lpg/cng/jet_a), freight (4 road variants + rail + sea + air), travel (3 air classes + 2 rail + taxi), purchase (2 material + 2 CNY-priced service). Catalog grew from 12 → 32 EFs.
3. **`extractHint(stageId, parsed)`** — per-stage hint extractor that builds the FTS5 query string from the salient free-text fields (`supplier_name` for utility, `fuel_type+fuel_category` for fuel, `mode+vehicle_class+supplier_name` for freight, etc.).
4. **`LLMClient.recommendEfs(config, parsedJson, candidates)`** — `gpt-4o-mini` call with zod-constrained output (exactly 3 recommendations with composite PKs + Chinese reasoning).
5. **`EfMatcherService.recommend({extraction_id, emission_source_id})`** — orchestrator that pulls candidates via `EfService.list`, sorts them by `bm25(ef_fts)` against the hint, sends the top 20 to the LLM, maps recommendations back to catalog rows (hallucinated PKs dropped), caches by `(extractionId, sourceId)` for the process lifetime. On LLM failure, returns `{recommended: [], ranked_full}` — the user still sees the FTS5-sorted full list.
6. **`ef:recommend` IPC channel** — zod-validated handler, allowlist entry in preload, `efMatcherApi` renderer client.
7. **`matcherHint` plumbing** — optional 3rd parameter on every `build*InitialValues` builder, threaded through `ExtractionReview` to `ActivityForm` via `initialValues.matcherHint`.
8. **ActivityForm Recommended UX** — TanStack Query against `efMatcherApi.recommend()`, fires when `matcherHint` + selectedSource both exist. Loading state shows "正在分析…"; empty state hides the section silently (failure is invisible to the user).

5 new i18n keys × 2 locales: `ef_matcher_recommended_heading`, `ef_matcher_loading`, `ef_matcher_all_candidates`, `ef_matcher_reasoning_label`, `ef_matcher_no_candidates`.

### Tests + quality

- **415 vitest tests** passing (up from 309 at `phase-1c`).
- Production build (`pnpm build`) clean — 2334 modules, paraglide compiled.
- `pnpm typecheck` clean.
- `pnpm lint --max-diagnostics=80` reports 0 errors (32 pre-existing `noNonNullAssertion` warnings unchanged).
- New: `tests/main/services/ef-matcher-service-smoke.test.ts` — 6 end-to-end matcher tests against the REAL seeded catalog (mocks only the LLM and upstream extraction/source rows).

### Known limitations carried into `phase-1d`

- **Routing API for distance_km is NOT in v1.** Freight and travel extractions often have null `distance_km`; users still enter it manually. Phase 2 work.
- **EF category granularity gap.** `emission_source.category` (user-chosen, e.g. `travel.air`) is coarser than the EF catalog's per-row category (e.g. `travel.air.economy.shorthaul`). `EfService.list({category})` does exact match, so a coarser source category may return zero candidates. Documented in `docs/PHASE-1-SMOKE.md`; pre-flagged for Phase 2 as a 2-line prefix-match change in `EfService.list`.

### Migration history

```
000_meta.sql                            (schema_migrations bookkeeping)
001_core.sql                            (org/source/period)
002_emission_factors.sql                (EF library + pinned)
003_extraction.sql                      (document + extraction)
004_inventory.sql                       (activity_data)
005_questionnaire.sql
006_audit.sql
007_seed_units.sql
008_seed_emission_factors.sql           (12 Phase 1a EFs)
009_settings.sql
010_ef_fts.sql                          ← NEW: FTS5 + triggers
011_seed_emission_factors_v2.sql        ← NEW: +20 EFs (32 total)
```

## phase-1c — 2026-04-15

Phase 1a + 1b foundation: `china_utility.v1` extraction stage, ActivityForm + Confirm flow, document upload + extraction pipeline, settings drawer, onboarding wizard. 309 vitest tests.

## phase-1b

Document upload + extraction pipeline + first stage (`china_utility.v1`).

## phase-1a

Database schema + seed EFs (12 rows) + activity data + calculation service.

## phase-0

Project scaffolding (Electron + Vite + React + TanStack Router + better-sqlite3 + paraglide).
