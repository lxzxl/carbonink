# Inbound Questionnaire — Supplier-Driven Scope 3 Cat 1 Data Collection

**Date:** 2026-05-27
**Status:** spec
**Trigger:** Reflective design audit on 2026-05-27. v1's questionnaire flow is one-directional (outbound: our inventory → customer's xlsx). Scope 3 Cat 1 ("purchased goods and services") cannot be sourced from our own inventory by definition — the data lives at our suppliers. We currently fall back to spend-based estimation with public EFs, which is an order of magnitude less accurate than supplier-specific data per GHG Protocol Scope 3 Standard, Ch. 7. This spec adds the *inbound* leg: we send a structured xlsx to a supplier, they fill it, we ingest their answers as `activity_data` rows.

## Goal

Build the round-trip:

1. User creates an "inbound questionnaire" against a supplier + reporting period, picking questions from a built-in **Cat 1 Supplier Disclosure** template.
2. App exports a structured `.xlsx` (questions on the left, evidence-upload prompts inline, supplier fills the right column).
3. User emails it to the supplier out-of-band (no cloud surface).
4. Supplier emails back the filled xlsx.
5. User imports it via the app, sees a review preview, approves.
6. Approved answers convert to `activity_data` rows under a new emission source attributed to that supplier, with a `supplier-specific` provenance trail.

Outbound v1 (CDP-style "fill *out* for a customer") and inbound v2.0 share the same `questionnaire` / `question` / `answer` tables, differentiated by a new `direction` column. The two flows are mutually exclusive at the IPC/UI level — an inbound questionnaire never runs `answer:generate`; an outbound questionnaire never runs the ingestion pipeline.

## Non-goals

- **Tier 3 (activity-data fallback).** v2.0 does not ask suppliers for raw fuel/electricity numbers we'd convert via public EFs. Suppliers either fill Tier 1 (per-unit PCF) or Tier 2 (allocated company emissions); if neither, the questionnaire returns no usable data and the user falls back to v1's spend-based estimation. Tier 3 deferred to v2.1+.
- **Cloud anything.** No magic-link supplier portal, no R2 evidence vault, no webhooks. Pure local xlsx round-trip.
- **Multi-template.** v2.0 ships exactly one template (Cat 1 Supplier Disclosure). Multi-template + user-authored questions deferred to v2.x.
- **Supplier identity / auth.** Suppliers are anonymous senders of xlsx files. The app trusts whoever the user accepts the file from.
- **Auto-ingest on import.** Every imported xlsx lands in a review state; the user must explicitly click "Approve and ingest" before `activity_data` rows are written.
- **Renaming `customer` → `counterparty`.** v2.0 adds a `role` column to the existing table. Cosmetic rename deferred.
- **Cross-questionnaire reuse.** v2.0 does not match incoming answers against a `narrative_bank`-style cache. Each supplier × period is a fresh ingestion.
- **LLM involvement.** Inbound is deterministic. No agent, no `generateObject`. Parsing is pure cell-coordinate lookup; ingestion is pure SQL.
- **Reporting period mismatch reconciliation.** xlsx header writes the expected period verbatim; if supplier returns numbers for a different period, the user catches it in review and rejects.
- **Evidence file storage.** v2.0 records evidence filenames as text annotations on the answer; we do NOT extract attached PDFs from the xlsx (Excel embeds aren't worth the parser complexity for v2.0).

## Current state (audited)

- `questionnaire` table has no `direction` column → every row implicitly outbound. **All existing rows must default to `'outbound'` post-migration.**
- `customer` table has no `role` column → every row implicitly a customer (in the v1 sense: upstream party asking us to fill their form).
- `question` table has no `tier` column → outbound questions don't need one; we add it nullable.
- `activity_data` table has `extraction_id TEXT REFERENCES extraction(id)` for OCR-derived rows but no field for inbound-questionnaire provenance. The existing FK is wrong shape for our use (extraction is a stage-OCR artifact); we add a parallel `inbound_question_id TEXT REFERENCES question(id)` + `inbound_tier INTEGER` pair.
- `answer.source_kind` enum is `('mapped_inventory','manual','ai_suggested','reused')`. Inbound answers come from the supplier (not our LLM), so the right semantic is closest to `manual` but actually distinct. **Decision: reuse `'manual'`** with `source_summary` carrying the inbound provenance JSON. Avoids a schema-enum migration; the supplier-vs-end-user distinction surfaces via `questionnaire.direction` on the parent.
- `answer:generate` IPC handler does not currently filter by direction. **Must guard against inbound questionnaires** (the agent has no useful tools for them).
- `answer:export-to-xlsx` writes filled answers back to an outbound questionnaire's source document. **Inbound has the inverse direction** (export a blank template, import a filled one). Separate IPC channels.
- `/questionnaires/$id` detail page hard-codes "Generate" / "Finalize" / "Export" buttons. **Needs a direction-aware action bar.**

## Architecture

```
┌─ Renderer ────────────────────────────────────────────────────────────────┐
│  /questionnaires                                                          │
│  ├─ List: badge per row (outbound / inbound) + filter chips               │
│  └─ "+ New questionnaire" wizard                                          │
│      └─ first step: pick direction (outbound = today; inbound = new)      │
│                                                                           │
│  /questionnaires/new?direction=inbound                                    │
│  ├─ Step 1: pick or create supplier (counterparty role='supplier')        │
│  ├─ Step 2: pick reporting period (defaults to active)                    │
│  ├─ Step 3: pick template (v2.0: only 'cat1_supplier_disclosure')         │
│  ├─ Step 4: checkbox each question (default: all checked)                 │
│  └─ Final action: "Create draft" → creates questionnaire (status='draft') │
│                                                                           │
│  /questionnaires/$id (inbound branch)                                     │
│  ├─ Header: supplier name, period, status, template label                 │
│  ├─ Question list: read-only, shows tier badges (Tier 1 / Tier 2 / meta)  │
│  └─ Action bar (sticky bottom):                                           │
│      · status='draft'      → [Export blank xlsx]                          │
│      · status='sent'       → [Import filled xlsx] [Re-export]             │
│      · status='received'   → [Review and ingest]                          │
│      · status='ingested'   → [View linked activities]                     │
│                                                                           │
│  /questionnaires/$id/ingest                                               │
│  ├─ Side-by-side review: question | supplier value | tier | derived row   │
│  ├─ Per-row accept/reject toggles                                         │
│  └─ "Confirm and ingest" → activity_data writes + status='ingested'       │
└───────────────────────────────────────────────────────────────────────────┘
                                  │
                                  │ IPC
                                  ▼
┌─ Main ────────────────────────────────────────────────────────────────────┐
│  inbound-template/                                                        │
│   ├─ cat1.ts        (the only template in v2.0 — 7 questions hard-coded)  │
│   └─ index.ts       (registry, returns by template_kind)                  │
│                                                                           │
│  InboundQuestionnaireService                                              │
│   ├─ createDraft({supplier_id, period_id, template_kind, included_qs})    │
│   │     → inserts questionnaire(direction='inbound', status='draft')      │
│   │     → inserts question rows (with tier, position, kind)               │
│   ├─ exportBlankXlsx(qid) → Buffer  (mark status='sent' on success)       │
│   ├─ importFilledXlsx(qid, file_bytes) → ImportPreview                    │
│   │     → parse cells, build per-question proposed values, NO commit      │
│   ├─ getIngestPreview(qid) → ImportPreview  (idempotent re-read)          │
│   └─ ingest(qid, accepted_question_ids) → IngestResult                    │
│         → for each Tier 1 answer: create supplier-specific EF + AD row    │
│         → for each Tier 2 answer: create AD row with co2e direct          │
│         → status='ingested', audit_event                                  │
│                                                                           │
│  ExcelTemplateRenderer                                                    │
│   ├─ render(template, supplier_name, period, included_qs) → ExcelJS WB    │
│   │   · sheet 1: cover (instructions, period, supplier name)              │
│   │   · sheet 2: Tier 1 (per-unit PCF)                                    │
│   │   · sheet 3: Tier 2 (allocated company emissions)                     │
│   │   · sheet 4: metadata (Q1-Q3: legal name, period, inventory status)   │
│   └─ parse(file_bytes, expected_template_kind) → ParsedAnswers            │
│       · sentinel-cell match: verifies it's the same template we exported  │
│       · returns per-position raw values + type coercion                   │
└───────────────────────────────────────────────────────────────────────────┘
```

## End-to-end user flow

Concrete scripted demo (also drives the smoke checklist below):

```
Phase A — outbound (the customer-driven side, v1, untouched):
  User has 碳墨's 2025 inventory in app.
  
Phase B — initiate inbound:
  1. User clicks "/questionnaires/new" → picks direction='inbound'
  2. Picks supplier "Acme Steel Co." (creates new counterparty if needed)
  3. Picks period 2025-annual
  4. Picks template "Cat 1 Supplier Disclosure"
  5. Reviews 7 questions, leaves all checked
  6. Clicks "Create draft" → lands on /questionnaires/$id
     DB: questionnaire row (direction='inbound', status='draft', tier-tagged questions)

Phase C — export + send (external):
  7. User clicks "Export blank xlsx" → save dialog → user picks path
     DB: questionnaire.status='sent', audit_event 'inbound_questionnaire.exported'
  8. User emails the xlsx to Acme externally (out of app scope)

Phase D — supplier fills (external):
  Acme staff opens xlsx, fills "Tier 2" sheet with their 2025 scope 1+2 = 850000 kgCO2e,
  allocation method='mass', attributable share=12000 kgCO2e (because we bought 1.2% of their tonnage).
  Acme emails the filled xlsx back.

Phase E — import + review:
  9. User clicks "Import filled xlsx" → file picker → selects Acme's reply
     IPC: questionnaire:inbound-import-preview(qid, file_bytes)
     DB: questionnaire.status='received', answer rows tentatively written (source_kind='manual',
         finalized_at=NULL — marker for "imported, not yet ingested")
     UI: navigates to /questionnaires/$id/ingest
 10. User reviews: Acme filled Tier 2 (Q5+Q6+Q7), left Tier 1 blank
     Preview shows: "Will create 1 activity_data row: 12000 kgCO2e under emission_source 'Acme Steel — purchased goods' (scope 3, cat1)"
 11. User clicks "Confirm and ingest"
     IPC: questionnaire:inbound-ingest(qid, [q5_id, q6_id, q7_id])
     DB: 
       - emission_source row created (if not exists) for "Acme Steel — purchased goods"
       - activity_data row: scope=3, amount=12000, unit=kgCO2e, co2e_kg=12000, no EF chain
                            (direct-co2e mode), inbound_question_id=Q7, inbound_tier=2
       - questionnaire.status='ingested', answer.finalized_at=now
       - audit_event 'inbound_questionnaire.ingested'

Phase F — close loop:
 12. User visits /activities → new row shows "来自供应商问卷" badge, links back to questionnaire
 13. Dashboard's scope 3 total reflects the +12000 kgCO2e
```

## Database schema changes

Single new migration: `migrations/0NN_inbound_questionnaire.sql`. NN to be assigned at implementation time (auto-numbered against current migration count).

```sql
-- 1) direction on questionnaire
ALTER TABLE questionnaire ADD COLUMN direction TEXT NOT NULL DEFAULT 'outbound'
  CHECK(direction IN ('outbound','inbound'));

-- New inbound statuses: 'draft', 'sent', 'received', 'ingested'.
-- Outbound statuses unchanged: 'parsing', 'mapping', 'answering', 'exported'.
-- The CHECK can't enforce direction↔status correlation in pure SQL without a trigger;
-- service layer enforces. Status enum widens:
--   (we do NOT alter the existing CHECK because SQLite drops/recreate is heavy;
--    instead, the service layer validates and the existing CHECK is broadened
--    via table recreate.)

-- Strategy: SQLite ALTER doesn't support modifying CHECK constraints in place,
-- so this migration uses the standard rename-create-copy-drop pattern:
CREATE TABLE questionnaire_new (
  id            TEXT PRIMARY KEY,
  customer_id   TEXT NOT NULL REFERENCES customer(id),
  document_id   TEXT REFERENCES document(id),   -- nullable now: inbound drafts have no source doc
  template_kind TEXT,
  reporting_year INTEGER NOT NULL,
  status        TEXT NOT NULL CHECK(status IN
                  ('parsing','mapping','answering','exported',
                   'draft','sent','received','ingested')),
  direction     TEXT NOT NULL DEFAULT 'outbound'
                  CHECK(direction IN ('outbound','inbound')),
  due_date      TEXT,
  created_at    TEXT NOT NULL
);
INSERT INTO questionnaire_new
  (id, customer_id, document_id, template_kind, reporting_year, status, direction, due_date, created_at)
  SELECT id, customer_id, document_id, template_kind, reporting_year, status, 'outbound', due_date, created_at
  FROM questionnaire;
DROP TABLE questionnaire;
ALTER TABLE questionnaire_new RENAME TO questionnaire;

-- 2) role on customer
ALTER TABLE customer ADD COLUMN role TEXT NOT NULL DEFAULT 'customer'
  CHECK(role IN ('customer','supplier'));

-- 3) tier on question
ALTER TABLE question ADD COLUMN tier INTEGER
  CHECK(tier IS NULL OR tier IN (1,2));

-- 4) inbound provenance on activity_data
ALTER TABLE activity_data ADD COLUMN inbound_question_id TEXT
  REFERENCES question(id);
ALTER TABLE activity_data ADD COLUMN inbound_tier INTEGER
  CHECK(inbound_tier IS NULL OR inbound_tier IN (1,2));
CREATE INDEX idx_activity_inbound_q ON activity_data(inbound_question_id)
  WHERE inbound_question_id IS NOT NULL;

-- Direct-co2e mode for activity_data:
-- Existing schema mandates ef_factor_code + ef_year + ... NOT NULL — every row
-- must FK into pinned_emission_factor. Tier 2 ingestion (direct kgCO2e from supplier,
-- no EF chain) breaks this invariant.
--
-- Resolution: keep ef_* NOT NULL but introduce a synthetic "sentinel" pinned EF row
-- per supplier × period representing "supplier-reported direct emissions, no
-- factor chain". This avoids a schema change to activity_data; the cost is one
-- extra pinned_emission_factor row per ingest.
--
-- The sentinel EF has:
--   factor_code = 'supplier_direct.<supplier_id>.<period_year>'
--   year, source, geography, dataset_version = period year, 'inbound_questionnaire',
--                                              'SUPPLIER', '1.0'
--   co2e_kg_per_unit = 1.0   (since activity_data.amount itself is the kgCO2e value)
--   input_unit = 'kgCO2e'
--   gwp_basis  = 'AR6'
--
-- This is a slight semantic stretch on pinned_emission_factor but contained.
-- v2.1 may add a proper "direct emission" mode to activity_data if multiple
-- inbound flows justify it.
```

The pinned-EF sentinel approach is deliberate: it preserves the existing FK invariant (every activity row is traceable to a pinned factor) while letting inbound supplier data flow through the same `activity_data` table the rest of the app already understands. Reports, dashboards, the EF-rebind UI all keep working without modification.

## Cat 1 template (the 7 questions, hard-coded)

Implementation: `desktop/src/main/services/inbound-templates/cat1.ts`. Pure constant export:

```ts
export const CAT1_SUPPLIER_DISCLOSURE = {
  template_kind: 'cat1_supplier_disclosure',
  version: '1.0',
  scope: 3,
  category: 'purchased_goods',
  ghg_protocol_path: 'scope3.cat1_purchased_goods',
  questions: [
    // ----- Metadata (no tier) -----
    {
      position: 'meta.1',
      tier: null,
      kind: 'narrative',
      raw_zh: '请填写贵公司法定名称（与营业执照一致）',
      raw_en: 'Please enter your company\'s legal name (matching business license).',
      expected_unit: null,
      cell_ref: 'metadata!B5',
    },
    {
      position: 'meta.2',
      tier: null,
      kind: 'narrative',
      raw_zh: '本次填报对应的报告期。我方采购报告期为 {{period_year}} 年，敬请填写贵公司对应的报告期（如 2024 财年 / 2025 自然年等）',
      raw_en: 'Reporting period this disclosure covers. Our purchase period: {{period_year}}.',
      expected_unit: null,
      cell_ref: 'metadata!B7',
    },
    {
      position: 'meta.3',
      tier: null,
      kind: 'categorical',
      raw_zh: '贵公司是否已编制正式的温室气体清单？（选填：无 / 自行核算未审 / 第三方核证 / 取得 ISO 14064 / 其他）',
      raw_en: 'Does your company maintain a formal GHG inventory? (None / Self-reported, unverified / Third-party verified / ISO 14064 certified / Other)',
      expected_unit: null,
      cell_ref: 'metadata!B9',
    },
    // ----- Tier 1: supplier-specific product carbon footprint -----
    {
      position: 'tier1.1',
      tier: 1,
      kind: 'numerical',
      raw_zh: '贵公司供给我方产品的单位碳足迹（kgCO2e/kg 产品）。如有第三方 PCF 报告请附在邮件中并在备注列注明文件名。',
      raw_en: 'Per-kg product carbon footprint of goods supplied to us (kgCO2e/kg). If a third-party PCF report exists, attach to email and note the filename in the comment column.',
      expected_unit: 'kgCO2e/kg',
      cell_ref: 'tier1!B5',
    },
    // ----- Tier 2: allocated company emissions -----
    {
      position: 'tier2.1',
      tier: 2,
      kind: 'numerical',
      raw_zh: '贵公司报告期内 Scope 1 + Scope 2 总排放量（kgCO2e）',
      raw_en: 'Your company\'s total Scope 1 + Scope 2 emissions for the reporting period (kgCO2e).',
      expected_unit: 'kgCO2e',
      cell_ref: 'tier2!B5',
    },
    {
      position: 'tier2.2',
      tier: 2,
      kind: 'categorical',
      raw_zh: '分配方法（按质量份额 / 按经济价值 / 按物理量 / 其他）',
      raw_en: 'Allocation method (mass-based / economic / physical / other).',
      expected_unit: null,
      cell_ref: 'tier2!B7',
    },
    {
      position: 'tier2.3',
      tier: 2,
      kind: 'numerical',
      raw_zh: '按上述分配方法归因于我方采购的排放量（kgCO2e）',
      raw_en: 'Emissions attributable to our purchase (kgCO2e), per the allocation method above.',
      expected_unit: 'kgCO2e',
      cell_ref: 'tier2!B9',
    },
  ],
} as const;
```

**Ingest selection logic** (when both Tier 1 and Tier 2 are filled):

- Per GHG Protocol convention, **Tier 1 wins** (more direct, less methodology variance).
- If only Tier 1 filled: amount = Tier1.1 value × our purchased quantity (read from our own activity inventory for the period, or 0 if unknown — flag in review).
- If only Tier 2 filled: amount = Tier2.3 value directly.
- If neither numerical filled: no `activity_data` row; supplier returned non-actionable data. User can still keep the questionnaire as a record (status stays 'received', never advances to 'ingested').

## xlsx layout

ExcelJS workbook structure:

```
Workbook
├─ "封面 / Cover"          — instructions, supplier name placeholder, period, deadline, contact
├─ "metadata"              — Q meta.1, meta.2, meta.3
├─ "tier1"                 — Q tier1.1 + comment column
├─ "tier2"                 — Q tier2.1, tier2.2, tier2.3
└─ "(hidden) sentinels"    — { template_kind, version, questionnaire_id } for parse validation
```

Cover sheet copy (Chinese, English mirror underneath each block):

> 您好。本表由 [我方公司名] 通过 CarbonInk 系统生成，用于收集贵公司报告期内（{{period_year}} 年）作为我方供应商所产生的温室气体排放数据。
>
> 填写说明：
> 1. 请优先填写 **Tier 1**（单位产品碳足迹）。如果贵公司持有第三方核证的 PCF 报告，这是最准确的口径。
> 2. 若无 PCF，请填写 **Tier 2**（公司层级分配排放）。需要填全三个字段。
> 3. 仅填部分字段也可，缺失字段我们会以行业平均估算。
> 4. 如有疑问请联系 [我方联系人]。
>
> 截止日期：{{due_date}}

The hidden sentinels sheet (not shown to supplier; not editable; just a fingerprint):

| key | value |
|---|---|
| `__carbonink.template_kind` | `cat1_supplier_disclosure` |
| `__carbonink.template_version` | `1.0` |
| `__carbonink.questionnaire_id` | `<uuid>` |
| `__carbonink.expected_period` | `2025` |

Parser refuses any xlsx without matching `template_kind` + `template_version` + `questionnaire_id`. This prevents accidentally importing the *outbound* xlsx, a different supplier's xlsx, or a tampered file.

## IPC channels

**New:**

```ts
// In src/main/ipc/types.ts (IpcTypeMap extension)

'questionnaire:inbound-create-draft': (input: {
  supplier_id: string;
  reporting_period_id: string;
  template_kind: 'cat1_supplier_disclosure';
  included_question_positions: string[];   // subset of template question positions
}) => Promise<{ questionnaire_id: string; question_count: number }>;

'questionnaire:inbound-export-xlsx': (input: {
  questionnaire_id: string;
}) => Promise<
  | { canceled: true }
  | { canceled: false; path: string }
>;

'questionnaire:inbound-import-preview': (input: {
  questionnaire_id: string;
  file_path: string;             // user picks via dialog upstream
}) => Promise<ImportPreview>;

'questionnaire:inbound-ingest': (input: {
  questionnaire_id: string;
  accepted_question_ids: string[];
}) => Promise<{
  activity_data_ids: string[];
  emission_source_id: string;
  ingested_at: string;
}>;

'supplier:list': () => Promise<Supplier[]>;
'supplier:create': (input: { name: string; notes?: string }) => Promise<Supplier>;
// (Reuses customer table with role='supplier')
```

**Modified:**

- `answer:generate` and `answer:generate-all-unanswered` must guard against `questionnaire.direction='inbound'` and throw a typed error (or just refuse — there's no useful semantic).
- `answer:export-to-xlsx` already operates on outbound only (by definition: it writes filled answers back to the customer's source document). No change, but document the assumption.
- `questionnaire:list` returns `direction` so the UI can filter/badge.

**Removed:** none.

## Import / parse pipeline

```
importFilledXlsx(qid, file_bytes) — concrete steps:

1. Load workbook via ExcelJS.
2. Read sentinels sheet:
   - if missing → error InboundInvalidTemplate (not our xlsx)
   - if template_kind mismatch → error InboundTemplateMismatch
   - if questionnaire_id mismatch → error InboundQuestionnaireMismatch
   - if expected_period mismatch + actual period blank → error
   - if expected_period mismatch + actual period filled → warning (surface in preview, user decides)
3. For each question in the questionnaire (loaded from DB):
   - read cell at template_question.cell_ref
   - coerce by question_kind:
     · numerical → strip units, parse Number; reject if non-finite
     · categorical → accept any non-empty string
     · narrative → accept any non-empty string
4. Build ImportPreview:
   {
     questionnaire_id,
     supplier_name,
     warnings: [{question_id, kind: 'period_mismatch'|'unit_unrecognized'|..., detail}],
     answers: [
       {
         question_id,
         tier,
         raw_value: string,
         parsed_value: number|string|null,
         is_blank: boolean,
         proposed_activity: {
           amount: number,
           unit: string,
           co2e_kg: number,
         } | null   // null for metadata / categorical / narrative
       }
     ],
     ingestion_plan: {
       tier_selected: 1 | 2 | null,
       emission_source_name: 'Acme Steel — purchased goods (2025)',
       activity_row_count: number,
       total_co2e_kg: number,
     }
   }
5. Write tentative answer rows (source_kind='manual', finalized_at=NULL) so re-opening
   the review page is idempotent.
6. Update questionnaire.status to 'received'.
7. Audit event 'inbound_questionnaire.imported'.
```

## Ingest pipeline

```
ingest(qid, accepted_question_ids):

1. Reload questionnaire, ensure status='received'.
2. Reload all tentative answers (source_kind='manual', finalized_at=NULL).
3. Filter to accepted_question_ids.
4. Apply tier-selection logic:
   - if tier 1 numerical answer accepted → use it; else if tier 2 trio (B5 + B9) → use Tier 2.
   - if neither → soft-fail (no activity row created); status stays 'received'.
5. Find-or-create emission_source for this supplier × period:
     name = '{supplier.name} — purchased goods ({period_year})'
     scope=3, category='purchased_goods', site_id=<our default site>
6. Create sentinel pinned_emission_factor row if not exists (Tier 2 direct-co2e mode).
7. Insert activity_data row:
   - scope=3, amount=<the kgCO2e value>, unit='kgCO2e'
   - ef_* = sentinel composite key
   - computed_co2e_kg = amount (1:1 in direct mode)
   - inbound_question_id = the chosen tier's Q ID
   - inbound_tier = 1 or 2
   - notes = '来自 {supplier.name} 供应商问卷 ({period_year})'
8. Mark answers finalized: UPDATE answer SET finalized_at=now WHERE question_id IN accepted.
9. UPDATE questionnaire SET status='ingested'.
10. Audit event 'inbound_questionnaire.ingested' with {qid, activity_data_ids, tier_selected, total_co2e_kg}.
```

Idempotency: re-running `ingest` on an already-`'ingested'` questionnaire is a no-op (returns existing activity_data_ids). Re-importing a different xlsx on a `'received'` questionnaire overwrites the tentative answer rows (transactional).

## UI changes

> **AS-BUILT (2026-05-29) — diverged from this section.** Mid-implementation the user
> asked to keep inbound and outbound "完全分开" (fully separate). Instead of overloading
> `/questionnaires` with a direction filter + an `$id/ingest` child, inbound shipped as its
> own top-level nav item and route tree: **`/supplier-disclosures`** ("供应商披露"), with
> outbound renamed to "披露填报" (`/questionnaires`, unchanged). So the as-built routes are
> `/supplier-disclosures` (list), `.../new` (wizard), `.../$id` (detail), `.../$id/ingest`
> (review-and-confirm). `InboundIngestPreview` was not split into its own component — the
> preview renders inline in the ingest route. The original design (below) is kept for
> rationale; read route paths as their `/supplier-disclosures` equivalents.

**New routes:**
- `/questionnaires/new` becomes a two-step wizard: pick direction → existing/new wizard branches.
- `/questionnaires/$id/ingest` — review-and-confirm page (preview + accept/reject toggles).

**Modified routes:**
- `/questionnaires` (list): direction filter chips ("全部 / Outbound / Inbound"), direction badge per row.
- `/questionnaires/$id`: sticky bottom action bar branches on `direction` + `status`.

**New components:**
- `SupplierPicker` — combobox over `customer` where role='supplier', with "create new" affordance.
- `InboundQuestionTable` — read-only listing showing tier badges (Tier 1 / Tier 2 / 元数据).
- `InboundIngestPreview` — side-by-side table of question | supplier value | proposed activity.

**Removed:** none.

## Audit events

Three new `event_kind` values:

| event_kind | when | payload |
|---|---|---|
| `inbound_questionnaire.exported` | xlsx written to disk | `{ questionnaire_id, supplier_id, path }` |
| `inbound_questionnaire.imported` | filled xlsx parsed (preview generated) | `{ questionnaire_id, warning_count, answer_count, blank_count }` |
| `inbound_questionnaire.ingested` | activity_data rows committed | `{ questionnaire_id, activity_data_ids, tier_selected, total_co2e_kg }` |

No sensitive content (no supplier email, no API keys, no question text — only IDs and counts).

## i18n keys

Both `messages/en.json` and `messages/zh-CN.json` get the same key set:

```
questionnaires_direction_outbound
questionnaires_direction_inbound
questionnaires_wizard_pick_direction
questionnaires_inbound_step_supplier
questionnaires_inbound_step_period
questionnaires_inbound_step_template
questionnaires_inbound_step_questions
questionnaires_inbound_export_blank
questionnaires_inbound_import_filled
questionnaires_inbound_review_title
questionnaires_inbound_review_accept
questionnaires_inbound_review_reject
questionnaires_inbound_ingest_confirm
questionnaires_inbound_ingest_success_with_co2e
questionnaires_inbound_status_draft
questionnaires_inbound_status_sent
questionnaires_inbound_status_received
questionnaires_inbound_status_ingested
questionnaires_inbound_tier_label_1
questionnaires_inbound_tier_label_2
questionnaires_inbound_tier_label_meta
questionnaires_inbound_warning_period_mismatch
questionnaires_inbound_warning_unit_unrecognized
questionnaires_inbound_warning_template_mismatch
questionnaires_inbound_warning_blank_template
inbound_template_cat1_name
inbound_template_cat1_description
```

The template's question text (`raw_zh` / `raw_en`) lives in `cat1.ts`, not in paraglide — it's content-as-data, not UI chrome.

## Testing approach

**Unit tests:**

- `inbound-templates/cat1.test.ts` — template integrity: 7 questions, no duplicate positions, each tier has at least one numerical, cell_ref strings well-formed.
- `excel-template-renderer.test.ts` — render produces expected sentinel cells + sheet structure; parse round-trips a synthetic answered workbook.
- `inbound-questionnaire-service.test.ts` — createDraft, exportBlankXlsx (mock fs), importFilledXlsx with synthetic xlsx Buffer, ingest happy + idempotent + tier-1-wins logic.
- `inbound-parser.test.ts` — covers each warning: blank cells, period mismatch, unit attached to number, sentinel mismatch.
- Schema migration test: existing outbound rows survive with `direction='outbound'`.

**Integration / answer-generation guard:**

- `answer-handlers.test.ts` — `answer:generate` against an inbound questionnaire returns the typed refusal.

**e2e (as-built):** the file-picker dialog still isn't playwright-able, so the parse/ingest
meat stays in unit tests — but the `/supplier-disclosures` *page* is now captured by the
Playwright route tour (`tests/e2e/tour.spec.ts`, snapshot `tour-05b-supplier-disclosures`),
so the new nav + list render can't silently regress.

**Baseline:** 830 → **932/932 as-built** (the v2.0 inbound test files plus the later
pi-agent answer-gen e2e). Never regress below the 830 baseline.

## Smoke checklist (manual, USER ACTION at end of plan)

After all tasks land:

1. Open dev → create new "inbound" questionnaire for a new supplier "Acme Steel" → 2025 → Cat 1 template → all 7 questions. Status = draft.
2. Export blank xlsx → open it → verify cover sheet copy + 4 sheets + sentinels are correct.
3. Manually fill Tier 2 (B5=850000, B7='mass-based', B9=12000) + Q meta.1='Acme Steel Co' + meta.2='2025-自然年' + meta.3='自行核算未审'. Save.
4. Back in app: "Import filled xlsx" → pick the file → review preview shows 4 answered + 3 blank, Tier 2 selected, proposed AD row = 12000 kgCO2e.
5. Click "Confirm and ingest" → toast confirms 1 activity_data row + 1 new emission_source.
6. Navigate to `/activities` → new row appears under "Acme Steel — purchased goods (2025)" with "来自供应商问卷" badge.
7. Navigate to dashboard → scope 3 total increased by 12000 kgCO2e.
8. SQL check: `SELECT event_kind, payload FROM audit_event WHERE event_kind LIKE 'inbound_questionnaire.%' ORDER BY occurred_at;` shows exported / imported / ingested.
9. Tier-1 path: repeat with a new supplier "Beta Chem" filling Tier 1 only (B5 of tier1 sheet = 2.5 kgCO2e/kg). Import + review should pick Tier 1; ingest needs to look up our 2025 purchase quantity from Beta Chem (TODO — for v2.0, since we don't have a supplier-link on existing AD rows, this might require manual entry of "purchased quantity" in the review step). **Decision for v2.0:** if Tier 1 used, the review step prompts for "Purchased quantity (kg)" inline; AD amount = Tier 1 PCF × user-entered quantity. Defer auto-link to inventory to v2.1.
10. Negative path: try importing the same xlsx twice — should be idempotent (no duplicate AD row).
11. Negative path: try importing an outbound xlsx (e.g. a customer-facing one) — should be rejected by sentinel mismatch.

## Out of scope (v2.0)

- Tier 3 (supplier reports activity data)
- Cloud-hosted web fill-in
- Multi-template (only Cat 1 in v2.0)
- User-authored questions
- Cat 4 / Cat 5 / other Scope 3 categories
- Subsidiary roll-up (parent → branch questionnaires)
- Automatic reminders / due-date emailing
- Evidence attachment storage (filenames captured as text only)
- LLM-assisted parse of free-form supplier emails (only structured xlsx)
- Auto-link Tier 1 PCF to existing inventory purchase quantity
- Period unit conversions (annual ↔ quarterly ↔ monthly mismatch)
- Cross-supplier benchmarking / data quality scoring
- Counterparty table rename (`customer` → `counterparty`)

## Future work (v2.1+)

- **Tier 3 fallback**: collect supplier's electricity / fuel / refrigerant usage, convert via our public EFs. Adds two more questions per Cat 1 template.
- **Multi-Cat templates**: Cat 4 (upstream transport), Cat 5 (waste), Cat 6 (business travel for outsourced operations).
- **Template authoring UI**: user adds custom questions on top of built-in templates.
- **Evidence PDF extraction**: re-use Phase 1c OCR stages to parse supplier-attached scope 1+2 verification reports inline with ingestion.
- **Cross-questionnaire reuse**: if same supplier × different period, prefill metadata from prior questionnaire; flag suspicious deltas (e.g. emissions dropped 80% — anomaly).
- **Subsidiary roll-up mode**: single org sends one template to N internal divisions, results aggregate into the parent's inventory under different sites.

## Verified smoke run (filled in after implementation)

**Method.** Steps 1–6 + 8 were exercised by hand against a live `pnpm dev` session on
2026-05-29 — that pass is what surfaced and got the import/ingest/notes/mount bugs fixed
(see the plan's Task 13). The negative + edge paths (9–11) are pinned by unit tests rather
than re-run manually; they're marked *unit* below. Build = dev (electron-vite, macOS).

| Step | Date | Build | Outcome | Notes |
|---|---|---|---|---|
| 1. Create inbound draft | 2026-05-29 | dev | ✅ | New supplier via `supplier:create` (needed allowlist fix `868d275`) |
| 2. Export blank xlsx | 2026-05-29 | dev | ✅ | 4 sheets + hidden `__sentinels`; status draft→sent |
| 3. Fill Tier 2 manually | 2026-05-29 | dev | ✅ | Values + a column-C note (note capture added `a57a8a7`) |
| 4. Import + preview | 2026-05-29 | dev | ✅ | Answers + notes now echo on detail (`89b7aae`,`a57a8a7`) |
| 5. Ingest + activity row | 2026-05-29 | dev | ✅ | Ingest page mount fixed (`4c5825d`); tier selector polished (`aea2c63`) |
| 6. /activities badge | 2026-05-29 | dev | ✅ | "来自供应商披露 · {supplier}" backlink to disclosure (`aea2c63`) |
| 7. Dashboard scope 3 total | — | dev | ⬜ | Not separately observed; AD row feeds the same scope-3 aggregate as v1 |
| 8. audit_event rows | 2026-05-29 | dev | ✅ | exported / imported / ingested kinds present; shapes also unit-asserted |
| 9. Tier 1 path | unit | — | ✅ | `inbound-questionnaire-service.test.ts` — Tier 1 PCF × inline quantity |
| 10. Idempotent re-import | unit | — | ✅ | re-import overwrites tentative answers; no duplicate AD on re-ingest |
| 11. Sentinel rejection | unit | — | ✅ | `excel-template-renderer.test.ts` — wrong-template sentinel mismatch throws |
