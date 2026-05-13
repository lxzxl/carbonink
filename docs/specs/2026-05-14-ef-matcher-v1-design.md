# EF Matcher v1 Design

**Date:** 2026-05-14
**Sub-project:** 5 of 5 — final Phase 1 deliverable
**Predecessor:** Per-stage component split (sub-project 4.5) — `commit 8ea5695` on `main`
**Successor:** Consolidated manual smoke + `phase-1d` tag

## Goal

Help the user pick the right emission factor for a Confirm flow by combining (a) **FTS5 full-text ranking** of the existing scope/category-filtered candidate list against extraction-derived hints, and (b) **an LLM-recommended top-3** that overlays a "Recommended for this document" section above the full list. Routing API for distance_km is **deferred to Phase 2**.

## Non-goals

- Routing API (Baidu/AMap) for freight/travel `distance_km`. Phase 2.
- LLM-driven category inference (we already get `category` from extractions).
- Re-ranking the canonical EF library — `emission_factor` rows are unchanged; FTS5 is a read-side view + the recommender returns existing composite PKs.
- A "create a new EF" flow. EF authoring is Phase 2.
- Recommendations across multiple stages simultaneously — the matcher takes the single current extraction.

## Current state audit (2026-05-14, `commit 8ea5695`)

- **EF table** (`emission_factor`): composite PK `(factor_code, year, source, geography, dataset_version)`; indexed `(scope, category)`. 12 seeded EFs from Phase 1a covering electricity (grid by region) + 4-5 fuels.
- **EfService** (`src/main/services/ef-service.ts`, 199 LOC): `list(EfLookupQuery)` + `get(EfCompositePk)` + pinning. No FTS, no recommender.
- **IPC** (`src/main/ipc/handlers/ef-library.ts`): exposes `ef:list`, `ef:get-by-pk`, `units:list`.
- **Preload allowlist** (`src/preload/bridge.ts`): channels are typed in `IpcTypeMap`.
- **ActivityForm** (`src/renderer/components/ActivityForm.tsx`, 556 LOC): calls `efApi.list({ category, scope })` after `emission_source_id` is picked; renders EFs as radio buttons; auto-fills `unit` from picked EF.
- **ExtractionReview** (`src/renderer/components/ExtractionReview.tsx`, 260 LOC after split): calls `build*InitialValues(data, filename)` and passes the result to `<ActivityForm initialValues=...>`. ActivityForm has NO direct access to extraction context today.
- **LLM** (`src/main/llm/`): AI SDK 6, OpenAI `gpt-4o-mini` already used for extraction.

## Architecture

```
┌─ Renderer ─────────────────────────────────────────────────────────────────┐
│  ExtractionReview                                                          │
│  └─ build*InitialValues(data, filename, { extractionId, stageId })         │
│        ▼                                                                   │
│  ActivityForm({ initialValues: { ..., matcherHint? } })                    │
│  └─ on emission_source_id pick:                                            │
│       useQuery(['ef:list', cat, scope])  ──┐                               │
│       useQuery(['ef:recommend', ...])   ──┤                                │
│       merge → top-3 starred + full list ◄─┘                                │
└────────────────────────────────────────────────────────────────────────────┘
                                │ IPC
                                ▼
┌─ Main ─────────────────────────────────────────────────────────────────────┐
│  ef:recommend handler (zod-validated)                                      │
│  └─ EfMatcherService.recommend(extractionId, sourceId)                     │
│       1. Read extraction.parsed_json + prompt_version from DB              │
│       2. Read source.scope/category                                        │
│       3. Pull candidate list via EfService.list({scope, category})         │
│       4. Sort candidates by FTS5 bm25 against extracted hints              │
│       5. Slice top 20 → pass to LLM                                        │
│       6. LLM returns 3 ef_keys + reasoning                                 │
│       7. Cache result in-memory by (extractionId, sourceId)                │
│       8. Return { recommended: EF[3], ranked_full: EF[] }                  │
└────────────────────────────────────────────────────────────────────────────┘
```

The renderer never sees the LLM directly — main owns the call. The matcher returns CONCRETE EF rows (composite PKs already resolved); the renderer just renders them.

## Component design

### FTS5 virtual table (`migrations/010_ef_fts.sql`)

```sql
CREATE VIRTUAL TABLE ef_fts USING fts5(
  factor_code UNINDEXED,
  year UNINDEXED,
  source UNINDEXED,
  geography UNINDEXED,
  dataset_version UNINDEXED,
  name_zh,
  name_en,
  description_zh,
  description_en,
  tokenize = "unicode61 remove_diacritics 2"
);

-- Backfill from existing rows.
INSERT INTO ef_fts(factor_code, year, source, geography, dataset_version,
                   name_zh, name_en, description_zh, description_en)
SELECT factor_code, year, source, geography, dataset_version,
       COALESCE(name_zh, ''), COALESCE(name_en, ''),
       COALESCE(description_zh, ''), COALESCE(description_en, '')
FROM emission_factor;

-- Keep in sync via triggers on emission_factor.
CREATE TRIGGER ef_fts_ai AFTER INSERT ON emission_factor BEGIN
  INSERT INTO ef_fts(factor_code, year, source, geography, dataset_version,
                     name_zh, name_en, description_zh, description_en)
  VALUES (NEW.factor_code, NEW.year, NEW.source, NEW.geography, NEW.dataset_version,
          COALESCE(NEW.name_zh, ''), COALESCE(NEW.name_en, ''),
          COALESCE(NEW.description_zh, ''), COALESCE(NEW.description_en, ''));
END;
CREATE TRIGGER ef_fts_ad AFTER DELETE ON emission_factor BEGIN
  DELETE FROM ef_fts WHERE
    factor_code = OLD.factor_code AND year = OLD.year AND
    source = OLD.source AND geography = OLD.geography AND
    dataset_version = OLD.dataset_version;
END;
CREATE TRIGGER ef_fts_au AFTER UPDATE ON emission_factor BEGIN
  DELETE FROM ef_fts WHERE
    factor_code = OLD.factor_code AND year = OLD.year AND
    source = OLD.source AND geography = OLD.geography AND
    dataset_version = OLD.dataset_version;
  INSERT INTO ef_fts(factor_code, year, source, geography, dataset_version,
                     name_zh, name_en, description_zh, description_en)
  VALUES (NEW.factor_code, NEW.year, NEW.source, NEW.geography, NEW.dataset_version,
          COALESCE(NEW.name_zh, ''), COALESCE(NEW.name_en, ''),
          COALESCE(NEW.description_zh, ''), COALESCE(NEW.description_en, ''));
END;
```

**Tokenizer choice:** `unicode61` (built-in to SQLite FTS5) handles both English and CJK reasonably for short labels. The Chinese names in our EFs are short noun phrases (`'中国国家电网平均'`, `'柴油'`); `unicode61` treats each CJK character as a token, which is appropriate for our query patterns (extracted hints like `'柴油'`, `'电费'`). We avoid `porter` because it mangles Chinese; we avoid `trigram` because it's overkill for short labels and increases index size 3x.

**Pinned EF table:** the pinned table (`pinned_emission_factor`, also defined in migration 002) is also affected by EF library content but is downstream of pinning. We do NOT add FTS triggers to it — pinning is a snapshot/commit operation, not a search target.

### EF coverage seeds (`migrations/011_seed_emission_factors_v2.sql`)

Add ~20 new rows so every stage's happy path returns at least one matchable recommendation. Stage breakdown:

- **fuel_receipt** (3 new): LPG / CNG / jet fuel. Existing Phase 1a has gasoline + diesel. Geographies = `CN` + `GLOBAL`. Source = `IPCC_AR6` for direct-combustion CO2.
- **freight** (8 new): road×generic + rail×generic + sea×generic + air×generic + 4 road-mode variants by vehicle class (heavy diesel truck / medium diesel truck / light van / refrigerated). All tonne-km basis. Source = `EcoInvent_3.10` (placeholder; the citation_url field accepts any URL).
- **travel** (5 new): air×economy + air×business + rail×highspeed + rail×regular + taxi×gasoline-vehicle. passenger-km or vehicle-km basis. Source = `DEFRA_2024` + `MEE_China`.
- **purchase** (4 new): steel (kg) + paper (kg) + generic-CNY-office-supplies + generic-CNY-services. Source = `EcoInvent_3.10` + `IPCC_AR6_Scope3`.

All AR6 GWP100. The CO2e coefficients are looked up from published sources at seed-write time; citations are recorded in `citation_url`. **Exact rows TBD by the implementer at seed-write time** — the plan provides the row schema and example values, but the implementer is responsible for picking citation-accurate coefficients (with cited URLs). The plan includes a placeholder check: each row must have a non-empty `citation_url` and a numeric `co2e_kg_per_unit`.

### EfMatcherService (`src/main/services/ef-matcher-service.ts`)

```ts
export type RecommendQuery = {
  extraction_id: string;
  emission_source_id: string;
};

export type MatcherRecommendation = {
  ef: EmissionFactor;
  reasoning_zh: string;
};

export type MatcherResult = {
  recommended: MatcherRecommendation[];   // 0-3 items; 0 if LLM fails
  ranked_full: EmissionFactor[];          // full filtered list, FTS5-sorted
};

export class EfMatcherService {
  constructor(deps: {
    db: Database;
    efService: EfService;
    extractionService: ExtractionService;
    emissionSourceService: EmissionSourceService;
    llmClient: LLMClient;
    cache?: Map<string, MatcherResult>;   // keyed by `${extractionId}|${sourceId}`
  });

  async recommend(q: RecommendQuery): Promise<MatcherResult>;
}
```

**Steps:**

1. **Cache lookup** — `${extraction_id}|${emission_source_id}`. Hit → return cached. Process-lifetime cache (no TTL); a new app launch clears it. The matcher result is deterministic given inputs.
2. **Fetch extraction** — `extractionService.get(extraction_id)` → row with `parsed_json`, `prompt_version`.
3. **Fetch source** — `emissionSourceService.get(emission_source_id)` → `{scope, category}`.
4. **Build candidate list** — `efService.list({scope: source.scope, category: source.category ?? undefined})`. If list is empty, return `{recommended: [], ranked_full: []}` immediately (no recommendation possible).
5. **Build FTS5 query** — concatenate the salient extracted hints into a space-joined query string. Per-stage hint extractors:
   - china_utility.v1 → `supplier_name`
   - fuel_receipt.v1 → `fuel_type + fuel_category`
   - freight.v1 → `mode + vehicle_class + supplier_name`
   - purchase.v1 → `category + item_description + supplier_name`
   - travel.v1 → `mode + travel_class + supplier_name`
   
   Trim each value; drop empties; escape FTS5 reserved chars (`*"():`) by quoting the whole query if any are present.
6. **FTS5 rank** — SQL: `SELECT e.* FROM emission_factor e JOIN ef_fts ON (5-column composite key match) WHERE ef_fts MATCH ? ORDER BY bm25(ef_fts) ASC LIMIT 20`. The candidate list from step 4 is the universe; intersect by composite PK. If the FTS5 match returns 0 rows (rare — only when hints have NO token overlap with any indexed text), fall back to the unsorted candidate list (step 4 result, truncated to 20).
7. **LLM top-K** — pass to `llmClient.recommendEfs(parsed_json, ranked_full[0..20])`. New method on the LLM client. Schema-constrained output (zod via AI SDK 6):
   ```ts
   const RecommendationSchema = z.object({
     recommendations: z.array(z.object({
       factor_code: z.string(),
       year: z.number().int(),
       source: z.string(),
       geography: z.string(),
       dataset_version: z.string(),
       reasoning_zh: z.string().max(200),
     })).length(3),
   });
   ```
   Prompt (Chinese, matching the rest of the system): asks the model to pick the 3 EFs most likely to match the document, with a 1-2 sentence Chinese explanation. Model: `gpt-4o-mini`.
8. **Resolve recommendations** — for each LLM-returned key, look up the EF row in `ranked_full` by composite PK. If a key doesn't match any candidate (hallucinated PK), drop it. After filtering, the recommendations array may have 0-3 entries.
9. **Error handling** — if any step from 5-7 throws (network, JSON parse, schema validation), log a warning and return `{recommended: [], ranked_full}`. The user still sees the FTS5-sorted full list.
10. **Cache + return.**

### IPC bridge

- New IpcTypeMap entry: `'ef:recommend': (input: RecommendQuery) => Promise<MatcherResult>`.
- New handler in `src/main/ipc/handlers/ef-matcher.ts` — zod-parses the query, calls `ctx.efMatcherService.recommend(...)`.
- Add `'ef:recommend'` to the preload allowlist in `src/preload/bridge.ts`.
- New renderer API client `src/renderer/lib/api/ef-matcher.ts` exporting `efMatcherApi.recommend(input)`.

### ActivityForm extension

- New optional prop on `ActivityFormInitialValues`:
  ```ts
  matcherHint?: { extraction_id: string; stage_id: string };
  ```
- When `matcherHint` is set AND `selectedSourceId` is non-null, fire a TanStack Query:
  ```ts
  useQuery(['ef:recommend', matcherHint.extraction_id, selectedSourceId], () =>
    efMatcherApi.recommend({ extraction_id, emission_source_id: selectedSourceId }),
    { enabled: !!matcherHint && !!selectedSourceId, staleTime: Infinity }
  );
  ```
- Render below the source picker, above the EF radio list:
  ```
  ┌─ Recommended for this document ───────────────────────────┐
  │  ○ ⭐ <EF name>     <reasoning>          <co2e/unit unit>  │
  │  ○ ⭐ <EF name>     <reasoning>          <co2e/unit unit>  │
  │  ○ ⭐ <EF name>     <reasoning>          <co2e/unit unit>  │
  └───────────────────────────────────────────────────────────┘
  
  All candidates (N):
  ○ <EF name>                                  <co2e/unit unit>
  ○ <EF name>                                  ...
  ```
- The recommended rows reuse the same `<input type="radio" name="ef">` group as the full list — picking a recommended EF wires the same way as picking from the full list. Visual difference: ⭐ icon + the `reasoning_zh` text on a second line.
- Loading state: while `efMatcherApi.recommend` is in-flight, render a "正在分析..." placeholder above the full list. **Do not block** the full list — user can still pick manually.
- Empty state: when `recommended.length === 0` (LLM failed or empty), hide the recommended section entirely. Don't surface the failure.

### ExtractionReview wiring

Each per-stage `build*InitialValues` function in `src/renderer/components/extractions/<stage>/prefill.ts` gets a new third parameter:

```ts
export function buildChinaUtilityInitialValues(
  data: ChinaUtilityParsed,
  filename: string,
  matcherHint?: { extraction_id: string; stage_id: string },  // NEW
): ActivityFormInitialValues {
  const out: ActivityFormInitialValues = {
    ...,
    matcherHint,  // NEW
  };
  ...
}
```

The orchestrator (`ExtractionReview.tsx`) builds the `matcherHint` once and passes it to whichever builder it dispatches:

```ts
const matcherHint = { extraction_id: extraction.id, stage_id: extraction.prompt_version };
const initialValues =
  parsed.stage === 'china_utility.v1' ? buildChinaUtilityInitialValues(parsed.data, document.filename, matcherHint) :
  parsed.stage === 'fuel_receipt.v1' ? buildFuelReceiptInitialValues(parsed.data, document.filename, matcherHint) :
  ... ;
```

All 5 builders get the same signature extension. The `matcherHint` parameter is optional (defaulting to absent) so existing callers (e.g., unit tests, future direct ActivityForm uses without an extraction) continue to compile.

### i18n keys (`messages/en.json` + `messages/zh-CN.json`)

Add 5 new keys:

| Key | English | 简体中文 |
|---|---|---|
| `ef_matcher_recommended_heading` | "Recommended for this document" | "为本单据推荐" |
| `ef_matcher_loading` | "Analyzing..." | "正在分析..." |
| `ef_matcher_all_candidates` | "All candidates" | "全部候选" |
| `ef_matcher_reasoning_label` | "Reason:" | "原因：" |
| `ef_matcher_no_candidates` | "No emission factors match this source's scope/category." | "未找到与该排放源范围/类别匹配的排放因子。" |

### Tests

This sub-project's safety net needs to cover three new code paths.

**Main-process unit tests:**

1. `tests/main/services/ef-matcher-service.test.ts`:
   - happy path: FTS5 returns ranked candidates, LLM returns 3 valid recommendations → result has 3 recommendations + ranked_full of len ≤ 20.
   - empty candidate list (source.scope/category has no EFs) → result is `{recommended: [], ranked_full: []}` immediately, no LLM call fired.
   - LLM throws → result has `recommended: []` but `ranked_full` is still populated; no exception bubbles.
   - LLM returns a hallucinated PK not in candidates → that recommendation is dropped silently.
   - Cache hit → second call doesn't invoke LLM.
   - Per-stage hint extraction → 5 sub-tests (one per stage) verifying the hint string for that stage.

2. `tests/main/db/migrations/010_ef_fts.test.ts`:
   - Trigger correctness: inserting an `emission_factor` row inserts into `ef_fts`. Deleting removes. Updating updates.
   - bm25 ranks more relevant rows higher: query `'柴油'` ranks the diesel EF higher than the gasoline EF.

3. `tests/main/ipc/handlers/ef-matcher.test.ts`:
   - `ef:recommend` zod-rejects malformed input (missing extraction_id).
   - Happy path delegates to the service.

**Integration smoke (existing extraction-service tests not affected):**

4. The 5 extraction-service.test.ts smoke tests continue to pass unchanged (the matcher is an opt-in code path triggered by `matcherHint`, not part of the extraction pipeline).

**Renderer tests:**

5. `tests/renderer/activity-form-matcher.test.tsx` (new file):
   - When `matcherHint` is set and source is picked, the "Recommended for this document" section renders with the mocked recommendations.
   - When `matcherHint` is set but LLM fails (mocked rejection), the recommended section is absent; full list still renders.
   - When `matcherHint` is null, the recommended section never renders (current ActivityForm behavior preserved).

Expected test count delta: ~25 new tests. Final count target: ~406.

### Out-of-scope follow-ups

- Routing API for distance_km. Phase 2.
- Recommender confidence scores or "why not this one" explanations.
- A UI for the user to override the recommender's ranking and have the override remembered (could go to a per-source preference table).
- FTS5 over `category` / `ghg_protocol_path` / `factor_code` (currently only over names + descriptions).
- LLM-driven seed-EF authoring or library expansion.
- Translation of EF names from English to Chinese / vice versa.

## Risk + safety net

| Risk | Caught by |
|---|---|
| FTS5 trigger desync (insert without trigger fires) | `010_ef_fts.test.ts` trigger correctness sub-tests + the FTS5 query in matcher service. |
| LLM hallucinated EF key | Step 8 filtering — only EFs that match candidate list make it to `recommended`. |
| LLM returns non-3 results | Zod schema requires `.length(3)` — non-conforming output throws, caught by step 9 error handling. |
| LLM call latency blocking UI | Renderer fires the query in parallel with `ef:list`. Loading state is non-blocking; full list still pickable. |
| Cache leaks | In-memory `Map`, process-lifetime — bounded by # of distinct `(extractionId, sourceId)` pairs in one session. |
| Migration ordering | Migrations 010 + 011 follow the existing numeric prefix. The migration runner picks them up automatically. |
| Existing renderer tests breaking | `matcherHint` is optional. The 4 existing documents-review renderer tests don't set it. |

## Expected end state

- 5 stages still ship (no extraction-stage changes).
- New migrations 010 (FTS5) and 011 (seed v2) applied; `ef_fts` virtual table present; ~32 EFs total.
- New `EfMatcherService` with cache + FTS5 + LLM pipeline.
- New IPC channel `ef:recommend`.
- ActivityForm renders "Recommended for this document" section when `matcherHint` flows in via `initialValues`.
- ExtractionReview passes `matcherHint` for all 5 stages.
- ~406 vitest tests passing (381 prior + ~25 new).
- `pnpm typecheck` clean, lint clean.
- 5 i18n keys added in en + zh-CN.
- After this lands: manual smoke covering all 5 stages × Confirm flow with recommender ON, then tag `phase-1d`.
