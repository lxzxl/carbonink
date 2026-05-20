# ISO 14064-1 Inventory Report — Design

**Date:** 2026-05-20
**Status:** Approved (brainstorming complete; ready for plan)
**Sub-project:** Phase 3 / 4 — first of 4 Phase 3 candidates
**Prior sub-projects shipped:** Phase 0 (foundation) + Phase 1 (5 stages + per-stage component split + EF Matcher v1) + Phase 2 (E2E refresh, routing API, Excel export, three-path answers, signature reuse, MCP server v1). 553 vitest tests passing on `main`.

---

## 1. Goal

Add a `/reports` route in the renderer that produces an ISO 14064-1-inspired GHG inventory report (PDF main + Excel appendix) for any `reporting_period`. The report uses LLM-generated narrative that the user reviews and edits before export.

**Audience:** consultant interim deliverable + leadership / stakeholder report (both — not third-party verification).

**Scope (in v1):**

- One `reporting_period` per export.
- Two output files per export: `<org-slug>-iso-14064-1-<year>-<lang>.pdf` (main) + `<org-slug>-iso-14064-1-<year>-<lang>-appendix.xlsx`.
- One language per export (zh-CN or en, user picks at generate-time; paraglide-driven).
- Schema additions for organizational boundary, responsible person, base year, recalc threshold, EF per-gas breakdown, EF biogenic CO2, reporting-period significant changes.
- Sections follow 14064-1 outline; data-backed sections are populated; sections we don't track ("uncertainty assessment", "verification statement") explicitly state "本期未评估 / Not assessed in this inventory".
- LLM-generated narrative with preview + inline-edit + confirm-to-export flow.

**Out of scope (v1):**

- Third-party verification flow.
- Multi-period comparison views.
- Persisted report drafts (each generate-click is fresh; export is terminal — re-export to regenerate).
- Multi-org bundled reports.
- Strict 14064-1 compliance (no per-gas mandate; no uncertainty assessment).

---

## 2. Architecture & Data Flow

```
[Renderer /reports]
    │
    │ 1. User picks reporting_period + lang
    ▼
[Renderer "Generate"] ──IPC──▶ [Main: report:generate (with client-generated report_id)]
                                        │
                                        │ 2. ReportDataService assembles
                                        │    InventoryReportData (org + period + sites
                                        │    + sources + activities + EFs + scope totals)
                                        ▼
                                  [LlmReportNarrativeService]
                                        │ 3. one streamObject call;
                                        │    partial deltas push report:progress
                                        │    with phase + sub_phase
                                        ▼
                                  [Return full data + narrative]
    │
    │ 4. Renderer caches in TanStack Query
    ▼
[Preview screen: <ReportPreview data={data} narrative={narrative} editable />]
    │
    │ 5. User edits narrative inline (local state only; no DB persistence)
    ▼
[User clicks "确认导出 → PDF + Excel"]
    │
    │ 6. Renderer triggers chained IPC:
    │      report:export-pdf  → hidden BrowserWindow + printToPDF + save dialog
    │      report:export-xlsx → exceljs + save dialog
    ▼
[Two files on disk; toast "已导出 PDF 与 Excel 附录"]
```

### Component responsibilities

| File | Responsibility |
|---|---|
| `src/main/services/report-data-service.ts` | Pure read-side: assembles `InventoryReportData` from sqlite. No LLM, no I/O beyond db. |
| `src/main/llm/report-narrative.ts` | One LLM call: `(data, lang) → ReportNarrative`. Zod-validated structured output via AI SDK `streamObject`. |
| `src/main/services/report-export-service.ts` | `printToPDF` orchestration (hidden BrowserWindow lifecycle) + exceljs xlsx writing. No data assembly. |
| `src/main/ipc/handlers/report.ts` | 4 channels: `report:generate`, `report:cancel`, `report:export-pdf`, `report:export-xlsx`. Holds AbortController map. |
| `src/renderer/routes/reports.tsx` | List of reporting periods + "新建报告" CTA. |
| `src/renderer/routes/reports_.$id.tsx` | Generate form → progress spinner → preview → export buttons. Owns editable narrative state. |
| `src/renderer/components/report/ReportPreview.tsx` | Single visual component used for both in-app preview and print render. WYSIWYG. |
| `src/renderer/components/report/sections/*.tsx` | Per-section subcomponents: CoverPage, OrgProfile, ReportingBoundary, ScopeTable, EfTable, NarrativeBlock, etc. |

### Key architectural choices

- **One visual component for preview and print.** The PDF is "the same React tree, rendered with print CSS." No second template engine, no drift.
- **`printToPDF` runs in a hidden offscreen BrowserWindow.** Avoids flicker in the user's session; no risk of mid-export navigation; same pattern Electron docs recommend.
- **No persistence in v1.** Each generate is fresh. Future v1.5 could add `generated_report` table for export history (YAGNI for now).

### IPC surface

| Channel | Direction | Purpose |
|---|---|---|
| `report:generate` | invoke | Input: `{ report_id: string; reporting_period_id: string; language: 'zh-CN'\|'en' }`. Returns `InventoryReportData + ReportNarrative` or typed error or `{ canceled: true }`. |
| `report:progress` | push (main→renderer) | Payload: `{ report_id: string; phase: 'assembling'\|'narrative'\|'finalizing'; sub_phase: 'boundary'\|'reporting-boundary'\|'methodology'\|'emissions'\|'changes'\|'observations'\|null }`. Mirrors Phase 1c `extraction:progress` pattern. |
| `report:cancel` | invoke | Input: `{ report_id: string }`. Looks up matching AbortController in main process, calls `.abort()`. |
| `report:export-pdf` | invoke | Input: `{ data, narrative, language }`. Returns `{ canceled: true } \| { ok: true, path: string } \| { ok: false, error }`. |
| `report:export-xlsx` | invoke | Same shape as export-pdf. |

All channels added to the preload allowlist (`src/preload/bridge.ts`) and `IpcTypeMap` / `IpcPushTypeMap` in `src/main/ipc/types.ts`.

### Cancellation

- Renderer generates a client-side `report_id` (ulid) before calling `report:generate`.
- Main process IPC handler module holds a `Map<report_id, AbortController>` that lives for the inflight call (`delete()` in a `finally`).
- AI SDK `streamObject({ ..., abortSignal })` receives the controller's signal.
- Cancel button → renderer calls `report:cancel` with the same `report_id`. The handler returns `{ canceled: true }` rather than throwing; renderer mutation resolves cleanly and the spinner goes away with no error toast.

---

## 3. Schema Additions

One new migration: `015_iso_report_schema.sql`. All columns nullable + sensible defaults; existing data continues to work. ALTER-only (no temp-table rebuild). Wrapped by `migrate.ts`'s outer transaction (no inner BEGIN/COMMIT).

### `organization` — extend existing column + 4 new columns

`organization.boundary_kind` **already exists** (values `'equity_share' | 'operational_control'` per migration 001). Extend its CHECK to add `'financial_control'`. Since SQLite can't ALTER CHECK, this requires a one-table temp rebuild (same pattern as migration 014).

| Column | Type | Notes |
|---|---|---|
| `boundary_kind` (extend existing) | TEXT | CHECK extended to `('equity_share', 'financial_control', 'operational_control')`. Existing rows preserved. |
| `responsible_person_name` | TEXT | New. Nullable. Surfaced in cover + §9.3.2. |
| `responsible_person_role` | TEXT | New. Nullable. e.g. "可持续发展负责人" / "Sustainability Officer". |
| `base_year_period_id` | TEXT | New. FK → `reporting_period(id)`. Nullable. |
| `recalc_threshold_pct` | REAL | New. Default `5.0`. Hidden in Settings v1 (advanced; expose if asked). |

### `reporting_period` — 2 new columns

| Column | Type | Notes |
|---|---|---|
| `significant_changes_text` | TEXT | Nullable. User-editable; LLM also fills. Surfaced in report §9.3.11. |
| `recalculation_reason` | TEXT | Nullable. Set only when this period triggered a base-year recalc — captures *why*. |

### `emission_factor` — 1 new column

Per-gas factors **already exist** as separate columns on `emission_factor`: `co2e_kg_per_unit`, `ch4_kg_per_unit`, `n2o_kg_per_unit`, `hfc_kg_per_unit`, `pfc_kg_per_unit`, `sf6_kg_per_unit`, `nf3_kg_per_unit`, plus `gwp_basis: 'AR5' | 'AR6'` (per migration 002). The report consumes these directly — no JSON column needed.

| Column | Type | Notes |
|---|---|---|
| `biogenic_co2_factor` | REAL | New. Nullable. Biogenic CO2 reported *separately* from inventory total per 14064-1 §6.4.7. |

### Zod schema updates

- `src/shared/schemas/organization.ts` — `organizationKindEnum` extended to include `'financial_control'`; `organization` shape adds `responsible_person_name`, `responsible_person_role`, `base_year_period_id`, `recalc_threshold_pct` (all nullable / defaulted).
- `src/shared/schemas/reporting-period.ts` — `reportingPeriod` adds `significant_changes_text`, `recalculation_reason` (both nullable).
- `EmissionFactor` (already in `src/shared/types.ts`) gains `biogenic_co2_factor` nullable field.

### Settings UI changes

Settings drawer adds section **"组织档案 (ISO 14064-1) / Organization Profile"**:

- Organizational boundary (radio: equity / financial control / operational control).
- Responsible person name + role (two text inputs).
- Base year (dropdown of existing reporting periods).
- Recalc threshold — hidden in v1 (default 5%).

---

## 4. LLM Narrative Contract

### Structured-output Zod schema (single object returned by the LLM)

```ts
const ReportNarrative = z.object({
  // 9.3.4 — describes the organizational boundary chosen + how applied
  boundary_description: z.string().min(50).max(800),

  // 9.3.5 — describes which scopes/categories included + exclusions justified
  reporting_boundary_description: z.string().min(50).max(800),

  // 9.3.14 — methodology + EF sources, narrative form
  methodology_description: z.string().min(100).max(1200),

  // Bridges emissions tables in human-readable narrative
  emissions_summary: z.string().min(100).max(1500),

  // 9.3.11 — significant changes vs prior period / base year
  significant_changes: z.string().min(20).max(800),

  // Per-source notable observations (e.g. dominant source = company fleet diesel)
  notable_observations: z.string().min(50).max(800),
});
```

### Prompt input block

```ts
type LlmInputBlock = {
  org: {
    name_zh: string | null;
    name_en: string | null;
    industry: string | null;
    country_code: string;
    boundary_kind: 'equity_share' | 'financial_control' | 'operational_control';
    responsible: { name: string | null; role: string | null };
  };
  period: {
    year: number;
    granularity: 'annual' | 'quarterly' | 'monthly';
    start: string;
    end: string;
    is_base_year: boolean;
  };
  sites: Array<{ name_zh: string | null; name_en: string | null; address: string | null }>;
  scope_totals: {
    scope1_kg: number;
    scope2_kg: number;
    scope3_kg: number;
    total_kg: number;
    biogenic_kg: number;
  };
  all_sources: Array<{
    name: string;
    scope: 1 | 2 | 3;
    co2e_kg: number;
    share_pct: number;
  }>;
  ef_sources_used: Array<{ source: string; count: number; gwp_basis: 'AR5' | 'AR6' }>;
  language: 'zh-CN' | 'en';
  prior_period_summary: { year: number; total_kg: number } | null;
  base_year_summary: { year: number; total_kg: number } | null;
};
```

The `org.name_zh` / `name_en` pair lets the LLM pick the language-appropriate display name without a separate translation step. `ef_sources_used` includes `gwp_basis` so the methodology narrative can disclose AR5 vs AR6.

### Prompt strategy (hard rules)

1. **System prompt** in the chosen language. ~600 tokens:
   - "你是 ISO 14064-1:2018 报告撰稿人, 严格遵循以下规则" / "You are an ISO 14064-1:2018 report writer..."
   - **CRITICAL FACT-LOCK**: "你只能使用 `<inventory>` 块中提供的数字与名称. 任何 `<inventory>` 中不存在的事实, 一律写 '本期未评估' / 'Not assessed in this inventory'. 严禁推测、补充或虚构."
   - Per-section length + tone guidance.
   - Boundary-type phrasing rule: if `boundary_type === 'equity'`, use "股权法 (equity share)" / "Equity share approach"; etc.
2. **User message** wraps the `LlmInputBlock` JSON in `<inventory>...</inventory>` tags.
3. **Structured output** via AI SDK 6 `streamObject` with the `ReportNarrative` Zod schema.
4. **Provider** = whichever the user configured (`settings:get-provider` — Claude / OpenAI / DeepSeek per Phase 1b).

### Streaming → progress events

`streamObject` emits partial deltas. The handler maps the currently-being-filled key to a `sub_phase` and pushes to `report:progress`:

| Field arriving | `sub_phase` pushed |
|---|---|
| `boundary_description` | `'boundary'` |
| `reporting_boundary_description` | `'reporting-boundary'` |
| `methodology_description` | `'methodology'` |
| `emissions_summary` | `'emissions'` |
| `significant_changes` | `'changes'` |
| `notable_observations` | `'observations'` |

Renderer maps `sub_phase` → i18n spinner text.

### Typed errors (Effect.fail variants)

Following the same pattern as `extraction-service`:

- `LlmNarrativeNoProvider` — `settings:get-provider` returned null.
- `LlmNarrativeTimeout` — > 120s with no completion.
- `LlmNarrativeRefused` — schema-invalid JSON after 3 retries.
- `LlmNarrativeCanceled` — AbortController fired (user clicked cancel).
- `LlmNarrativeRateLimit` — provider 429 after retries.

### Edit semantics

Once narrative arrives, the renderer holds it as mutable local-state. User edits are not persisted to DB in v1 (export-or-discard). On user-triggered re-generate, fresh LLM output replaces local state with a confirm modal warning unsaved edits will be lost.

---

## 5. PDF + Excel Rendering

### PDF — Electron `printToPDF` from a hidden BrowserWindow

```
[Renderer requests report:export-pdf with final narrative + InventoryReportData + lang]
    │
    ▼
[Main creates hidden BrowserWindow:
   show: false, webPreferences.offscreen: true,
   loadURL → dedicated /print-render route]
    │
    │ Window receives data via IPC arg and renders <ReportPreview printMode />
    │
    │ Renderer signals "DOM stable" via IPC report:print-ready
    │ (waits for fonts + images via document.fonts.ready)
    ▼
[Main calls webContents.printToPDF({
   marginsType: 1, printBackground: true, pageSize: 'A4',
   headerTemplate, footerTemplate
 }) → Buffer]
    │
    ▼
[showSaveDialog({
   defaultPath: `${orgSlug}-iso-14064-1-${year}-${lang}.pdf`
 })]
    │
    ▼
[fs.writeFile + close hidden window in finally]
```

### Print mode CSS

In `report-preview.css`:

- `@page { size: A4; margin: 20mm 18mm; }`
- `@page :first { margin-top: 0 }` — cover page.
- `.page-break` utility for explicit breaks between cover / TOC / scope tables.
- `@media print` overrides: hide nav, force black text, drop background gradients.
- Headers/footers via Chromium's `headerTemplate` / `footerTemplate` (page number + report title).

### Excel — single workbook, 5 sheets

Sheet names + column headers are in the export's chosen language (one or the other, never bilingual within a file).

| Sheet (zh-CN / en) | Content | Purpose |
|---|---|---|
| `概览` / `Overview` | Org, period, scope totals, generated date | Quick read |
| `活动明细` / `Activities` | Every `activity_data` row: site, source, scope, period, amount, unit, EF pinned, co2e_kg | Full data trace |
| `排放因子` / `Emission Factors` | Every distinct pinned EF used: name, source, value, unit, gas breakdown (if present), biogenic flag | EF provenance |
| `排放源` / `Emission Sources` | Every `emission_source` referenced: name, scope, site, description | Source inventory |
| `叙述` / `Narrative` | The 6 narrative sections as plain-text cells, one per row | Consultant copy-paste / verify |

Formatting: numbers right-aligned, dates ISO format, scope columns colored (scope1=red, scope2=orange, scope3=blue) via existing exceljs styling. Same aesthetic as the questionnaire export shipped in Phase 2.2c.

### File naming

```
<org-slug>-iso-14064-1-<year>[-<granularity>]-<lang>.pdf
<org-slug>-iso-14064-1-<year>[-<granularity>]-<lang>-appendix.xlsx
```

- `org-slug` = `organization.name_en` if non-null else `organization.name_zh` if ASCII-slugifiable else first 8 chars of `organization.id`.
- `granularity` suffix is omitted when the reporting period is `'annual'`; otherwise appended (e.g. `-q1`, `-q3`).
- e.g. `acme-corp-iso-14064-1-2025-zh-CN.pdf` (annual zh) or `acme-corp-iso-14064-1-2025-q3-en.pdf` (quarterly en).

### Export sequence

1. User clicks "确认导出 → PDF + Excel" in preview.
2. `report:export-pdf` → save dialog → PDF written.
3. On success, automatically chains to `report:export-xlsx` → save dialog → xlsx written.
4. Toast: "已导出 PDF 与 Excel 附录" / "PDF and Excel appendix exported".
5. Preview stays alive so user can re-edit + re-export.

If either save dialog is canceled, the chain stops cleanly (no partial state).

---

## 6. Error Handling

| Failure | Where it surfaces | Handling |
|---|---|---|
| No LLM provider configured | `report:generate` returns `LlmNarrativeNoProvider` | Renderer shows inline alert with "前往设置 →" link to Settings drawer |
| LLM call fails after retries | Effect typed error | Toast with retry button; preview stays on form state |
| LLM rate-limited (429) | `LlmNarrativeRateLimit` | Toast "请稍后再试"; form stays alive |
| User cancels mid-generate | `report:cancel` → AbortController fires; handler returns `{ canceled: true }` | Mutation resolves with canceled marker; spinner away; no error toast |
| `printToPDF` throws | Main try/catch returns `{ ok: false, error }` | Toast "PDF 导出失败: <message>" |
| User cancels save dialog | `dialog.showSaveDialog` returns `{ canceled: true }` | Silently abort the chain |
| `exceljs.writeFile` throws | Main try/catch | Toast "Excel 导出失败: <message>" |
| Migration runs on a DB that already has the new columns | migrate.ts version table prevents re-run | Already handled |

### Recovery invariants

- All errors leave the renderer in a state where re-clicking "Generate" or "Export" retries cleanly.
- The hidden BrowserWindow is closed in a `finally` block — never leaks.
- The AbortController `Map<report_id, AbortController>` entry is `.delete()`'d in `finally` — cancellation cannot target a stale id.

---

## 7. Testing Strategy

### Unit (vitest)

| Module | Test focus |
|---|---|
| `report-data-service.test.ts` | Real-DB roundtrip: seed org + period + 5 sources + 10 activities + 3 EFs → `assembleReportData()` → assert shape, scope totals, biogenic separated correctly |
| `report-narrative.test.ts` | Mock LLM provider returning canned JSON → assert Zod parses, partial deltas trigger correct `report:progress` sub-phases |
| `report-export-service.test.ts` | Excel path only (PDF is Electron API, integration-tested separately): call `writeAppendixXlsx(buf, data, lang)` → load with exceljs → assert sheet names, headers, row counts |
| `report-handlers.test.ts` | IPC unit: mocked services → assert channel allowlist + AbortController lifecycle + cancel-during-flight semantics |
| `migration-015.test.ts` | Migration applies on a v014 DB; ALTER columns present; existing rows unaffected |

### Renderer (vitest + happy-dom)

| Component | Test focus |
|---|---|
| `routes/reports.tsx` | Lists existing periods; "新建报告" CTA disabled when `organizational_boundary` not set in Settings (with inline hint) |
| `routes/reports_.$id.tsx` | Mock IPC: generate triggers spinner with progress phase text; cancel button calls `report:cancel`; on success preview renders |
| `ReportPreview.tsx` | Given canned data + narrative, renders 6 sections in correct order; `printMode` prop changes CSS class |

### E2E smoke (existing harness)

- One `cannedReportGenerate` IPC override added to LaunchOpts (per `e92181e` / Phase 2 E2E pattern).
- One spec: "user navigates /reports → picks period → generate → preview shows narrative → export → save dialog opens" (mocked save dialog from existing harness).
- Both PDF + Excel paths smoke-tested with mocked file writers.

### Out of scope (deliberately)

- No "real LLM" tests — flaky + costly.
- No actual PDF byte-content validation — `printToPDF` is an Electron API; we test orchestration around it.
- No verification that the exported PDF visually matches the preview — manual smoke deferred to consolidated phase-3 tag-time verification.

### Test count target

~25 new tests (~5 unit modules + 3 renderer + 1 E2E spec). Project goes from 553 → ~578.

---

## 8. Dependencies

- **`exceljs`** — already in deps (used by `answer:export-to-xlsx` in Phase 2.2c).
- **Electron `BrowserWindow.webContents.printToPDF`** — built into Electron 41; no new dep.
- **AI SDK 6 `streamObject`** — already used by extraction-service.
- **Zod** — already used throughout.
- **paraglide** — already used for i18n.
- **No new top-level dependencies.**

---

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| LLM hallucinates facts not in the inventory data | System prompt's fact-lock rule + Zod schema constrains shape; user-in-the-loop preview + edit before export catches anything that slips through |
| PDF page-break behavior differs between preview and exported file | Same React tree + `printMode` prop drives both; CSS `@media print` rules tested manually at phase-3 tag time |
| Generation latency > 60s in worst case | Push-channel progress events + cancel button keep UX tolerable without persistent queue infrastructure |
| Hidden BrowserWindow leaks on crash | `finally`-block close + handler-level try/catch around the entire export pipeline |
| Schema migration breaks Phase 1/2 data | Migration is additive-only (ALTER ADD COLUMN with nullable defaults); existing `migrate.ts` version-table guard prevents re-run |
| Existing users have no `organizational_boundary` set | UI gates "Generate" CTA on the field being set; inline hint links to Settings; no silent fallback |

---

## 10. Acceptance

- `pnpm test` passes 578+ tests (553 baseline + ~25 new).
- `pnpm typecheck` clean.
- `biome check` clean.
- Manual smoke deferred to phase-3 tag-time consolidated verification.
- Schema migration applies on a Phase 1+2 DB without breaking the 553 existing tests.
- A user with organizational_boundary set can: navigate to `/reports`, pick a `reporting_period`, click Generate, see streaming progress text, see the preview render with all 6 narrative sections, edit any narrative section inline, click 确认导出, see two save dialogs in sequence, end up with PDF + Excel files on disk.

---

## 11. Future v1.5+

Out of scope but on the horizon:

- **Per-section regenerate buttons** in preview (Approach B from the brainstorm).
- **`generated_report` table** for export history (when / who / which version of narrative).
- **Bilingual side-by-side** PDF.
- **Multi-period comparison** report variant (year-over-year deltas).
- **Verification statement** flow when an external verifier is involved.
- **Per-gas inventory mandate** (force users to fill `gas_breakdown` for top-N EFs).
- **PDF export the questionnaire answers** as well — could merge with the Phase 3 "PDF rearrange export" candidate.
