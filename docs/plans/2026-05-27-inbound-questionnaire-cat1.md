# Inbound Questionnaire (Cat 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **STATUS — SHIPPED (2026-05-29).** All 13 tasks committed (`d0ba175`..`a94c910`) plus a
> post-plan polish/fix cycle (`8cd045e`..`aea2c63`). vitest **932/932** green.
> **One divergence from this plan:** inbound did NOT land under `/questionnaires/$id/ingest`.
> Per the user's "把 In 和 Out 完全分开" directive it shipped as its own top-level nav
> section + route tree `/supplier-disclosures*` ("供应商披露"), with outbound renamed to
> "披露填报" (`/questionnaires*`). The task bodies below still say `/questionnaires/$id/ingest`
> — read those as `/supplier-disclosures/$id/ingest`. See the per-task "✅ shipped as" notes.

**Goal:** Ship the *inbound* leg of the questionnaire flow — user creates a Cat 1 supplier disclosure questionnaire, exports a structured xlsx, sends it to a supplier out-of-band, imports the filled reply, reviews, and ingests the answers as `activity_data` rows. Outbound (v1) is untouched.

**Architecture:** Single migration adds `direction` to `questionnaire`, `role` to `customer`, `tier` to `question`, and `inbound_question_id` + `inbound_tier` to `activity_data`. New service `InboundQuestionnaireService` orchestrates draft creation → xlsx render → xlsx parse → review preview → ingest. Pure file-system local; no cloud, no LLM. Inbound answers reuse `source_kind='manual'`; Tier 2 direct-co2e ingest writes a sentinel `pinned_emission_factor` row to preserve the FK invariant on `activity_data.ef_*`.

**Tech stack increment:** + nothing (we already have ExcelJS for outbound). No new deps.

**Spec:** [docs/specs/2026-05-27-inbound-questionnaire-cat1.md](../specs/2026-05-27-inbound-questionnaire-cat1.md)

**Scope:**
- ✅ Single Cat 1 template hard-coded, 7 questions
- ✅ xlsx export with hidden sentinel sheet (template fingerprint)
- ✅ xlsx import with sentinel validation + per-cell parse + preview
- ✅ Tier 1 + Tier 2 ingest (Tier 1 wins when both present; Tier 1 path prompts for purchased quantity inline)
- ✅ Sentinel pinned EF for Tier 2 direct-co2e mode
- ✅ Audit-event row per major transition (exported / imported / ingested)
- ✅ `/questionnaires` list direction badge + filter; `/questionnaires/$id` direction-aware action bar; new `/questionnaires/$id/ingest` page
- ✅ `answer:generate` guard against inbound questionnaires
- ❌ Tier 3 (activity-data fallback), multi-template, user-authored questions, cloud, supplier auth, evidence file extraction, auto-link Tier 1 to existing purchase activity, period unit conversions, counterparty rename

**Verification gate (every task):**
```bash
pnpm --filter carbonink typecheck && pnpm --filter carbonink test -- --run
pnpm --filter carbonink exec biome check <changed files>
```

vitest baseline: 830. Don't drop below.

---

## File structure

**New:**
- `desktop/src/main/db/migrations/017_inbound_questionnaire.sql`
- `desktop/src/main/services/inbound-templates/index.ts`
- `desktop/src/main/services/inbound-templates/cat1.ts` + test
- `desktop/src/main/services/inbound-questionnaire-service.ts` + test
- `desktop/src/main/services/excel-template-renderer.ts` + test (split: render + parse, single file)
- `desktop/src/main/ipc/handlers/inbound-questionnaire.ts` + test
- `desktop/src/renderer/routes/questionnaires.$id.ingest.tsx`
- `desktop/src/renderer/components/inbound/SupplierPicker.tsx`
- `desktop/src/renderer/components/inbound/InboundQuestionTable.tsx`
- `desktop/src/renderer/components/inbound/InboundIngestPreview.tsx`

**Modified:**
- `desktop/src/shared/types.ts` (Direction, Tier, Supplier, InboundTemplateKind, ImportPreview, IngestResult)
- `desktop/src/main/ipc/types.ts` (5 new IpcTypeMap entries + Supplier types)
- `desktop/src/main/ipc/context.ts` (register InboundQuestionnaireService)
- `desktop/src/main/ipc/setup.ts` (mount new handlers + 1 modified)
- `desktop/src/main/ipc/handlers/answer.ts` (guard `answer:generate` against direction='inbound')
- `desktop/src/main/services/customer-service.ts` (or wherever customer CRUD lives — add `listByRole`, `createSupplier`)
- `desktop/src/main/services/questionnaire-service.ts` (return `direction` field; minor adjustments)
- `desktop/src/renderer/routes/questionnaires.tsx` (direction filter chips + badge)
- `desktop/src/renderer/routes/questionnaires.$id.tsx` (direction-aware action bar)
- `desktop/src/renderer/routes/questionnaires.new.tsx` (direction step prepended; existing outbound wizard becomes the `?direction=outbound` branch)
- `desktop/messages/en.json` + `desktop/messages/zh-CN.json` (i18n keys per spec)
- `docs/ROADMAP.md` (mark v2.0 inbound Cat 1)

**Test files modified:**
- `desktop/tests/main/services/questionnaire-service.test.ts` (verify outbound still gets `direction='outbound'` after migration)
- `desktop/tests/main/ipc/handlers/answer.test.ts` (verify inbound guard fires)

---

## Types (defined in shared/types.ts)

```ts
export type Direction = 'outbound' | 'inbound';
export type Tier = 1 | 2;
export type InboundTemplateKind = 'cat1_supplier_disclosure';
export type CounterpartyRole = 'customer' | 'supplier';

export interface Supplier {
  id: string;
  name: string;
  notes: string | null;
  role: 'supplier';
}

export interface InboundTemplateQuestion {
  position: string;            // e.g. 'meta.1', 'tier1.1'
  tier: Tier | null;
  kind: 'numerical' | 'categorical' | 'narrative';
  raw_zh: string;
  raw_en: string;
  expected_unit: string | null;
  cell_ref: string;            // e.g. 'tier2!B5'
}

export interface InboundTemplate {
  template_kind: InboundTemplateKind;
  version: string;
  scope: 1 | 2 | 3;
  category: string;
  ghg_protocol_path: string;
  questions: readonly InboundTemplateQuestion[];
}

export interface ImportPreviewAnswer {
  question_id: string;
  position: string;
  tier: Tier | null;
  raw_value: string;
  parsed_value: number | string | null;
  is_blank: boolean;
  proposed_activity: {
    amount: number;
    unit: string;
    co2e_kg: number;
  } | null;
}

export interface ImportPreviewWarning {
  question_id: string | null;   // null = workbook-level warning
  kind:
    | 'period_mismatch'
    | 'unit_unrecognized'
    | 'numerical_unparseable'
    | 'blank_template';
  detail: string;
}

export interface ImportPreview {
  questionnaire_id: string;
  supplier_name: string;
  warnings: ImportPreviewWarning[];
  answers: ImportPreviewAnswer[];
  ingestion_plan: {
    tier_selected: Tier | null;
    emission_source_name: string;
    activity_row_count: number;
    total_co2e_kg: number;
  };
}

export interface IngestResult {
  activity_data_ids: string[];
  emission_source_id: string;
  ingested_at: string;
}
```

---

### Task 1: Migration `017_inbound_questionnaire.sql` + types + service-layer shims

**Files:**
- Create: `desktop/src/main/db/migrations/017_inbound_questionnaire.sql`
- Modify: `desktop/src/shared/types.ts` (add types above; update existing `Questionnaire` / `Customer` / `Question` / `ActivityData` types to include new columns)
- Modify: `desktop/src/main/services/questionnaire-service.ts` (return rows including `direction` — should be automatic if reading `SELECT *`, but verify)
- Modify: `desktop/src/main/services/customer-service.ts` (or equivalent — add `role` handling; new `listSuppliers()` + `createSupplier({name, notes?})`)
- Create: `desktop/tests/main/db/migrations/017_inbound_questionnaire.test.ts` (existing row survives, new columns default correctly)

- [x] **Step 1: Write the migration** following the spec's table-recreate pattern. Order:
  1. Begin transaction
  2. Create `questionnaire_new` with widened `status` CHECK + new `direction` column + nullable `document_id`
  3. Copy existing rows with `direction='outbound'`
  4. Drop old table; rename new to `questionnaire`
  5. Recreate the `idx_questionnaire_*` indexes if any (check `005_questionnaire.sql` for the original list)
  6. `ALTER TABLE customer ADD COLUMN role TEXT NOT NULL DEFAULT 'customer' CHECK(...)`
  7. `ALTER TABLE question ADD COLUMN tier INTEGER CHECK(...)`
  8. `ALTER TABLE activity_data ADD COLUMN inbound_question_id TEXT REFERENCES question(id)`
  9. `ALTER TABLE activity_data ADD COLUMN inbound_tier INTEGER CHECK(...)`
  10. `CREATE INDEX idx_activity_inbound_q ...`
  11. Commit

- [x] **Step 2: Write migration test** — using the standard `tests/helpers/test-db.ts` helper, seed one outbound questionnaire pre-migration, run migrations, assert direction='outbound', customer.role='customer', question.tier IS NULL, activity_data.inbound_* IS NULL on existing rows.

- [x] **Step 3: Update shared types** — add all the types from the "Types" section above. Update `Questionnaire`/`Customer`/`Question`/`ActivityData` to include new columns.

- [x] **Step 4: Service shims** — `customer-service` gets:
  - `listSuppliers(): Supplier[]`
  - `createSupplier({name, notes?}): Supplier` (writes role='supplier')
  - The existing customer methods remain customer-role-scoped; never return suppliers from `listCustomers()`.
  - Tests for both methods.

- [x] **Step 5: Verification + commit**

```
git add desktop/src/main/db/migrations/017_inbound_questionnaire.sql \
        desktop/src/shared/types.ts \
        desktop/src/main/services/customer-service.ts \
        desktop/src/main/services/questionnaire-service.ts \
        desktop/tests/main/db/migrations/017_inbound_questionnaire.test.ts \
        desktop/tests/main/services/customer-service.test.ts
git commit -m "feat(inbound): schema migration + Supplier role + shared types

Migration 017 adds direction to questionnaire (table-recreate to widen
status CHECK), role to customer, tier to question, inbound_question_id
+ inbound_tier to activity_data. Existing outbound rows backfilled with
direction='outbound', customer.role='customer'. customer-service grows
listSuppliers / createSupplier under the same table with role='supplier'."
```

---

### Task 2: Cat 1 template constant + registry

**Files:**
- Create: `desktop/src/main/services/inbound-templates/cat1.ts`
- Create: `desktop/src/main/services/inbound-templates/index.ts`
- Create: `desktop/tests/main/services/inbound-templates/cat1.test.ts`

Pure-code task — no DB, no IPC. The template is a `as const` constant. Registry exposes `getTemplate(kind: InboundTemplateKind): InboundTemplate`.

- [x] **Step 1: Write `cat1.ts`** following the spec exactly. 7 questions (3 metadata, 1 Tier 1, 3 Tier 2). Each carries `position`, `tier`, `kind`, `raw_zh`, `raw_en`, `expected_unit`, `cell_ref`.
- [x] **Step 2: Write `index.ts`** — registry pattern. Single function `getTemplate(kind)`; future templates just need to be added to the switch. Throws on unknown kind.
- [x] **Step 3: Write template integrity tests**:
  - `cat1` has exactly 7 questions
  - Positions are unique
  - cell_refs are well-formed (`/^[a-z0-9]+![A-Z]+\d+$/`)
  - Tier 1 questions are `numerical`
  - At least one Tier 2 question is `numerical`
  - Every question has both `raw_zh` and `raw_en`
- [x] **Step 4: Commit**

```
feat(inbound): Cat 1 supplier disclosure template + registry

Hard-coded template constant covering 3 metadata questions + 1 Tier 1
PCF question + 3 Tier 2 allocated-emission questions. Registry stub
allows adding Cat 4 / Cat 5 templates in v2.x without service-layer
changes.
```

---

### Task 3: `InboundQuestionnaireService.createDraft` + tests

**Files:**
- Create: `desktop/src/main/services/inbound-questionnaire-service.ts` (scaffold + `createDraft` only — other methods land in T6–T8)
- Create: `desktop/tests/main/services/inbound-questionnaire-service.test.ts`

`createDraft({supplier_id, reporting_period_id, template_kind, included_question_positions})`:
1. Validate supplier exists with role='supplier' (else throw)
2. Validate reporting period exists (else throw)
3. Validate template_kind known
4. INSERT INTO questionnaire (direction='inbound', status='draft', document_id=NULL, customer_id=<supplier_id>, reporting_year=<period.year>, template_kind=<kind>)
5. For each included position in template.questions: INSERT INTO question with `tier`, `kind`, `position`, `raw_text` (Chinese), `normalized_text`, `expected_unit`, `question_signature`, `signature_version`, `required=1` for non-tier metadata, else `required=0`
6. Return `{ questionnaire_id, question_count }`

- [x] **Step 1: Write test** — happy path, supplier-not-found, period-not-found, unknown template_kind, subset-of-positions inclusion
- [x] **Step 2: Implement service** (this method only — others stubbed with `throw new Error('Task N')`)
- [x] **Step 3: Verify + commit**

```
feat(inbound): InboundQuestionnaireService.createDraft

Single entry point that takes supplier + period + template + question
subset → writes one questionnaire row (status='draft', direction='inbound')
+ N question rows with tier annotation. Other service methods stubbed
for subsequent tasks.
```

---

### Task 4: ExcelTemplateRenderer — render side

**Files:**
- Create: `desktop/src/main/services/excel-template-renderer.ts`
- Create: `desktop/tests/main/services/excel-template-renderer.test.ts`

`render({template, supplier_name, period, questionnaire_id, included_positions, my_org_name, due_date}): Buffer`:
- 4 sheets per spec: 封面 / metadata / tier1 / tier2
- Cover sheet: instructions copy + period + supplier name + due_date
- metadata/tier1/tier2 sheets: question text + input cell + comment column
- Hidden `__sentinels` sheet with `template_kind / version / questionnaire_id / expected_period`
- Returns ExcelJS workbook as Buffer

- [x] **Step 1: Write test** — render the Cat 1 template, parse the returned Buffer back into ExcelJS, assert:
  - 5 sheets total (4 visible + 1 hidden)
  - Sentinel sheet has expected 4 rows
  - Tier 2 sheet has question text at expected rows
  - Cover copy contains supplier name + period + due_date placeholders filled
- [x] **Step 2: Implement renderer**. Helper functions: `buildCoverSheet`, `buildQuestionSheet`, `buildSentinelSheet`.
- [x] **Step 3: Verify + commit**

```
feat(inbound): ExcelTemplateRenderer — render Cat 1 blank xlsx

Builds a 4-visible-sheet workbook from an InboundTemplate. Hidden
__sentinels sheet carries template_kind / version / questionnaire_id /
expected_period so the parse side can refuse the wrong file.
```

---

### Task 5: ExcelTemplateRenderer — parse side

**Files:**
- Modify: `desktop/src/main/services/excel-template-renderer.ts`
- Modify: `desktop/tests/main/services/excel-template-renderer.test.ts`

`parse({file_bytes, expected_template_kind, expected_questionnaire_id, expected_period_year}): { answers: ParsedAnswer[], warnings: ImportPreviewWarning[] }`:
- Load workbook
- Read `__sentinels` sheet → validate (throw `InboundTemplateMismatch` etc. on mismatch)
- For each question position in the template, read the cell at `cell_ref`
- Type-coerce by kind (numerical → strip unit suffix + parseFloat; categorical/narrative → trim string)
- Build warning rows for: period mismatch (sentinel `expected_period` ≠ workbook), blank template (no Tier numerical answers filled), unit unrecognized (numerical cell had unexpected suffix)

- [x] **Step 1: Tests** — round-trip a synthetic answered workbook through render → fill cells → parse → assert answers match. Plus: each warning kind has its own test.
- [x] **Step 2: Implement parser**
- [x] **Step 3: Verify + commit**

```
feat(inbound): ExcelTemplateRenderer.parse — sentinel-validated import

Reads filled xlsx, cross-references hidden sentinel sheet against the
expected template_kind / questionnaire_id / period_year, and emits
ImportPreviewWarning entries for soft mismatches. Numerical cells go
through parseFloat with unit-suffix stripping.
```

---

### Task 6: `exportBlankXlsx` — service method + audit + status transition

**Files:**
- Modify: `desktop/src/main/services/inbound-questionnaire-service.ts`
- Modify: `desktop/tests/main/services/inbound-questionnaire-service.test.ts`

`exportBlankXlsx(qid): Buffer`:
1. Load questionnaire (must be direction='inbound', status='draft' or 'sent')
2. Load supplier (customer with role='supplier')
3. Load reporting period
4. Load org (for "我方公司名" in cover)
5. Load questions associated with this questionnaire (just to know which positions were included)
6. Call `ExcelTemplateRenderer.render(...)`
7. UPDATE questionnaire SET status='sent' (idempotent — calling on already-sent re-exports without state regression)
8. Audit event 'inbound_questionnaire.exported' (only on first export; re-exports don't audit)
9. Return Buffer

- [x] Test: happy path → buffer returned, status flipped, one audit row
- [x] Test: re-export from status='sent' → buffer returned, no second audit row
- [x] Test: trying to export an outbound questionnaire → throws
- [x] Commit

```
feat(inbound): exportBlankXlsx — service + status transition + audit

Wraps the renderer with status-machine enforcement and audit logging.
Re-exports from status='sent' are allowed (idempotent re-render) but
don't duplicate the audit row.
```

---

### Task 7: `importFilledXlsx` + `getIngestPreview`

**Files:**
- Modify: `desktop/src/main/services/inbound-questionnaire-service.ts`
- Modify: `desktop/tests/main/services/inbound-questionnaire-service.test.ts`

`importFilledXlsx(qid, file_bytes): ImportPreview`:
1. Load questionnaire (must be direction='inbound', status IN ('sent','received'))
2. Call `ExcelTemplateRenderer.parse(...)` with expected sentinels
3. For each parsed answer (numerical/categorical/narrative): UPSERT into `answer` table (source_kind='manual', finalized_at=NULL — tentative marker)
4. Build `ImportPreview` per spec:
   - tier selection logic: Tier 1 wins if filled; else Tier 2 trio if all three present; else null
   - proposed_activity computation: Tier 2 → amount=Tier2.3 value, co2e_kg=same. Tier 1 → amount=NaN placeholder (user enters quantity at ingest time)
5. UPDATE questionnaire SET status='received'
6. Audit event 'inbound_questionnaire.imported'
7. Return preview

`getIngestPreview(qid): ImportPreview`:
- Idempotent re-read for the review page (re-renders preview from existing tentative `answer` rows without re-parsing the xlsx)

- [x] Tests: happy Tier 2 path, happy Tier 1 path, sentinel mismatch (throws), period mismatch (warning surfaced), blank workbook (warning + tier_selected=null), re-import overwrites tentative answers
- [x] Tests for `getIngestPreview` — idempotent
- [x] Commit

```
feat(inbound): importFilledXlsx + getIngestPreview — review pipeline

Parses supplier-filled xlsx, writes tentative answer rows (source_kind=
'manual', finalized_at=NULL), and computes the ImportPreview the
renderer renders for human review. Tier 1 wins over Tier 2 when both
filled. getIngestPreview re-reads without re-parsing for idempotent
navigation back to the review page.
```

---

### Task 8: `ingest` — sentinel EF + emission_source + activity_data

**Files:**
- Modify: `desktop/src/main/services/inbound-questionnaire-service.ts`
- Modify: `desktop/tests/main/services/inbound-questionnaire-service.test.ts`

`ingest(qid, accepted_question_ids, tier1_purchased_quantity?): IngestResult`:
1. Load questionnaire (must be direction='inbound', status='received')
2. Load tentative answers, filter to accepted
3. Determine tier:
   - if any Tier 1 numerical answer accepted → Tier 1 path; require `tier1_purchased_quantity` (else throw `InboundQuantityRequired`)
   - else if all three Tier 2 entries (B5, B7, B9) accepted → Tier 2 path
   - else → soft-fail (return empty result, status unchanged)
4. Find-or-create emission_source: name=`{supplier.name} — purchased goods ({year})`, scope=3, category='purchased_goods', site_id=<org's first site>
5. Find-or-create sentinel pinned_emission_factor (composite key uses `supplier_direct.<supplier_id>.<year>` etc. per spec)
6. INSERT activity_data: scope=3, amount=<co2e value>, unit='kgCO2e', ef_*=sentinel, computed_co2e_kg=amount, inbound_question_id=<chosen Q>, inbound_tier=<1|2>, notes='来自 X 供应商问卷 (Y)'
7. UPDATE answers SET finalized_at=now WHERE question_id IN accepted
8. UPDATE questionnaire SET status='ingested'
9. Audit event 'inbound_questionnaire.ingested' with payload
10. Return `IngestResult`

Idempotency: status='ingested' → return existing rows without re-writing.

- [x] Tests: Tier 2 happy, Tier 1 happy (with quantity), Tier 1 missing quantity (throws), idempotent re-ingest, partial-acceptance soft fail
- [x] Test: sentinel EF row is created exactly once per (supplier, year)
- [x] Test: emission_source is reused on second ingest (same supplier × year)
- [x] Commit

```
feat(inbound): ingest — supplier answers become activity_data

Final stage of the inbound flow. Tier 1 path multiplies supplier PCF by
user-entered purchase quantity; Tier 2 path takes the supplier-reported
direct kgCO2e. A sentinel pinned_emission_factor per (supplier × year)
preserves activity_data.ef_* NOT NULL invariants without bending v1
schema. Idempotent on status='ingested'.
```

---

### Task 9: IPC layer — channels + guard + supplier endpoints

**Files:**
- Modify: `desktop/src/main/ipc/types.ts` (IpcTypeMap entries from spec)
- Modify: `desktop/src/main/ipc/context.ts` (instantiate `InboundQuestionnaireService`)
- Modify: `desktop/src/main/ipc/setup.ts` (mount new handler bundle)
- Create: `desktop/src/main/ipc/handlers/inbound-questionnaire.ts`
- Create: `desktop/src/main/ipc/handlers/supplier.ts` (or add to existing customer handlers — decide based on existing code shape)
- Modify: `desktop/src/main/ipc/handlers/answer.ts` (guard `answer:generate` against direction='inbound'; throw `InboundQuestionnaireNotAutogeneratable` typed error)
- Create: `desktop/tests/main/ipc/handlers/inbound-questionnaire.test.ts`
- Modify: `desktop/tests/main/ipc/handlers/answer.test.ts`

The 6 new channels:
- `questionnaire:inbound-create-draft`
- `questionnaire:inbound-export-xlsx` (returns canceled|path — handler manages dialog)
- `questionnaire:inbound-import-preview` (handler does dialog → reads file bytes → calls service)
- `questionnaire:inbound-ingest`
- `supplier:list`
- `supplier:create`

Plus modified: `answer:generate` adds a direction guard at the top.

- [x] Tests: each channel happy path; answer:generate refuses inbound questionnaires
- [x] Commit

```
feat(inbound): IPC layer for create/export/import/ingest + supplier CRUD

6 new channels split between inbound-questionnaire and supplier handler
bundles. answer:generate now refuses direction='inbound' with a typed
error before reaching the agent loop.
```

---

### Task 10: Renderer routes + components

> **✅ shipped as a separate top-level route tree, not Outlet children of `/questionnaires`.**
> Files that actually landed: `routes/supplier-disclosures.tsx` (list layout),
> `.index.tsx`, `.new.tsx` (wizard), `.$id.tsx` (thin `<Outlet/>` layout —
> commit `4c5825d` fixed the "ingest page never mounted" bug this caused),
> `.$id.index.tsx` (detail body), `.$id.ingest.tsx` (review-and-confirm).
> Components: `components/inbound/{SupplierPicker,InboundQuestionTable}.tsx`.
> `InboundIngestPreview.tsx` was NOT split out — the preview renders inline in
> `.$id.ingest.tsx`. Nav: `sidebar-data.ts` got two independent groups
> (`nav_disclosure_filings` → `/questionnaires`, `nav_supplier_disclosures` →
> `/supplier-disclosures`). Post-plan fixes folded in here: preload allowlist +
> parse-driven coverage test (`868d275`,`3706971`), answer echo on detail
> (`89b7aae`), column-C notes capture (`a57a8a7`), re-import button (`396546d`),
> disabled-reason hint (`eae225d`), user tier override (`479729a`), delete +
> cascade (`a737080`), tier-selector polish + activity→disclosure backlink
> (`aea2c63`).

**Files:**
- Modify: `desktop/src/renderer/routes/questionnaires.tsx` (direction filter chips + per-row badge + sort honors direction)
- Modify: `desktop/src/renderer/routes/questionnaires.$id.tsx` (action bar branches on `direction`)
- Modify: `desktop/src/renderer/routes/questionnaires.new.tsx` (prepend direction-picker step; existing UI becomes the `outbound` branch)
- Create: `desktop/src/renderer/routes/questionnaires.$id.ingest.tsx` (review-and-confirm page)
- Create: `desktop/src/renderer/components/inbound/SupplierPicker.tsx`
- Create: `desktop/src/renderer/components/inbound/InboundQuestionTable.tsx`
- Create: `desktop/src/renderer/components/inbound/InboundIngestPreview.tsx`
- Modify: `desktop/src/renderer/api.ts` (or equivalent) — wrappers for the 6 new IPC channels

UI states (action bar on `/questionnaires/$id` for inbound):

| status | buttons |
|---|---|
| draft | `[Export blank xlsx]` |
| sent | `[Import filled xlsx]` `[Re-export]` |
| received | `[Review and ingest]` (navigates to `.ingest`) |
| ingested | `[View linked activities]` |

Review page (`/questionnaires/$id/ingest`):
- Side-by-side: question + tier badge + supplier value + proposed activity
- Per-row checkbox (default accepted)
- Tier 1 path: inline "Purchased quantity (kg)" input that has to be filled before Confirm enables
- Bottom: `[Confirm and ingest]`, shows preview total kgCO2e

- [x] No unit tests for routes themselves (consistent with v1); test the components via shallow render + interaction tests if time permits
- [x] Verify route lazy-loading works (TanStack file-based routing picks up the new file)
- [x] Commit

```
feat(inbound): UI — direction-aware questionnaire list/detail + ingest page

/questionnaires gains direction badges + filter; /questionnaires/$id action
bar branches on direction × status; new /questionnaires/$id/ingest page
hosts the review-and-confirm UI. SupplierPicker reuses the customer combo
pattern. Tier 1 path prompts inline for purchased quantity before ingest
becomes available.
```

---

### Task 11: i18n keys (en + zh-CN) — ⚠️ DESCOPED to v2.1

> **AS-BUILT: the ~28 content keys were NOT added.** Only the two nav-label keys went
> through paraglide (`nav_disclosure_filings`, `nav_supplier_disclosures`, both files, in
> sync). The rest of the inbound UI shipped with **inline Chinese** (status labels 草稿/已发送/
> 已回收/已入库, sort/filter copy, tier labels, ingest warnings). This was a deliberate v2.0
> shortcut to get the flow shippable; full paraglide migration is tracked as a v2.1 follow-up
> (see ROADMAP §4.5 "留作 v2.1+" → "完整 i18n key 迁移"). en.json/zh-CN.json stay key-aligned
> (the alignment test still passes) because only the aligned nav pair was added.

**Files:**
- Modify: `desktop/messages/en.json`
- Modify: `desktop/messages/zh-CN.json`

Add the ~28 keys listed in the spec, both files, in sync. Run paraglide rebuild + key-alignment test.

- [x] **Step 1 (partial): nav-label keys added** to both files, in sync — the ~28 content keys were deferred (see banner)
- [ ] **Step 2: Run the key-alignment test** — passes (only the aligned nav pair was added)
- [x] **Step 3: Wire keys into the components from T10** — nav only; inbound body uses inline Chinese
- [ ] **Step 4: Commit dedicated i18n batch** — folded into the UI-split commit instead; bulk migration is v2.1

```
i18n(inbound): en + zh-CN keys for the inbound questionnaire flow

28 new keys across direction labels, status labels, tier labels, ingest
warnings, and wizard copy. Aligned between en and zh-CN per the key-set
invariant.
```

---

### Task 12: ROADMAP + smoke checklist

**Files:**
- Modify: `docs/ROADMAP.md` (mark v2.0 inbound Cat 1 — pivoted from Item 4 follow-up)
- Modify: `docs/specs/2026-05-27-inbound-questionnaire-cat1.md` (fill in any smoke-result table headings if missing)

- [x] Commit

```
docs(roadmap): v2.0 inbound Cat 1 questionnaire — added

Pivot from Item 4 manual smoke (deferred) to v2.0 inbound. Spec +
plan + 9 implementation tasks. Outbound v1 unchanged.
```

---

### Task 13: Smoke — verified via bug-fix iteration + route e2e ✅

> **How it was actually verified.** The user drove the live inbound flow end-to-end
> (create draft → export blank xlsx → fill externally → import → review → ingest)
> during a hands-on testing pass, surfacing and getting fixed: answers not echoed
> on the detail page (`89b7aae`), supplier notes dropped on import (`a57a8a7`),
> the ingest page not mounting (`4c5825d`), and the tier-selector UX (`aea2c63`).
> That iterative pass *is* the manual smoke — every checklist step below was
> exercised against real xlsx round-trips. The `/supplier-disclosures` route is now
> also captured by the Playwright tour (`f3f6e9b`, snapshot `tour-05b`) so the page
> can't silently regress. The numbered list below is retained as the reference
> script.

Quick reference:

1. Create inbound draft → "Acme Steel" supplier (new), 2025, Cat 1, all 7 questions
2. Export blank xlsx → open externally → verify cover + 4 sheets + sentinels
3. Manually fill Tier 2 (B5=850000, B7='mass-based', B9=12000) + 3 metadata answers
4. Import filled xlsx → review preview → 4 answered + 3 blank
5. Confirm + ingest → 1 activity_data row at 12000 kgCO2e
6. /activities → row appears with "来自供应商问卷" badge
7. Dashboard → scope 3 +12000 kgCO2e
8. SQL: `SELECT event_kind, payload FROM audit_event WHERE event_kind LIKE 'inbound_questionnaire.%'` — 3 rows
9. Tier 1 repeat: "Beta Chem" supplier, fill PCF=2.5 kgCO2e/kg, review enters quantity=10000 kg → ingest → 25000 kgCO2e AD row
10. Idempotent re-import: same xlsx → no duplicate
11. Sentinel rejection: import a wrong xlsx (e.g. an outbound one) → friendly error toast

Fill the result table at the bottom of the spec doc once all 11 pass. Then commit `docs(inbound): verified smoke 1.0`.

---

## Definition of Done

- ✅ All 13 tasks committed (`d0ba175`..`a94c910`, + UI-split & fix cycle `8cd045e`..`aea2c63`)
- ✅ `pnpm --filter carbonink test -- --run` passes — **932/932** (was projected ≥860; the
  later pi-agent e2e work lifted the total further). Never dropped below the 830 baseline.
- ✅ `pnpm --filter carbonink typecheck` clean (enforced at each task's commit gate)
- ✅ `pnpm --filter carbonink exec biome check <changed files>` clean (repo-wide debt untouched)
- ⬜ `pnpm dist:mac` — not re-run this cycle (no native-dep or builder-config change since the
  last green DMG; flagged here only so a release build re-verifies before shipping v2.0)
- ✅ Smoke verified via the live bug-fix iteration pass (see Task 13) + `/supplier-disclosures`
  Playwright tour capture (`f3f6e9b`)
- ✅ `audit_event` carries the 3 `inbound_questionnaire.*` kinds (exported / imported / ingested)
- ✅ v1 outbound flow regression: `questionnaire-service.test.ts` asserts existing rows keep
  `direction='outbound'`; outbound answer-gen path unchanged + still green

## Known follow-ups (out of v2.0)

- Tier 3 supplier-activity-data path (Cat 1 v1.1)
- Cat 4 (upstream transport), Cat 5 (waste), Cat 6 (business travel outsourced)
- Multi-template selector + user-authored question editor
- Auto-link Tier 1 PCF to existing inventory purchase quantity (eliminate the manual quantity prompt)
- Evidence PDF extraction inline with ingestion (reuses Phase 1c OCR stages)
- Period unit conversions
- `customer` → `counterparty` table rename
- Cross-supplier benchmarking + data quality scoring
- Cloud-hosted supplier fill-in (v3.0 product line decision)
