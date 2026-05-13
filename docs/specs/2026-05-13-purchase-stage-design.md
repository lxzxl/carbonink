# `purchase.v1` extraction stage — design

> Status: design approved through brainstorming session 2026-05-13.
> Next: `writing-plans` produces the implementation plan.
> Prior art: `china_utility.v1` (Phase 1b), `fuel_receipt.v1` (sub-project 1), `freight.v1` (sub-project 2 — just landed).

## §1 — Goal & scope

**Goal**: fourth extraction stage. Phase 1 deliverable ("5 种典型单据") moves from 3/5 to 4/5. Users upload a Chinese purchase invoice (采购发票 / 增值税专用发票 / 商业发票), the AI extracts supplier + item description + category + quantity + amount + date, the existing Confirm → ActivityForm → activity_data flow runs end-to-end. Architecture and UX shape are identical to the prior 3 stages.

**In scope**:

- New `Stage<PurchaseExtraction>` registered as `purchase.v1`.
- Zod schema with **two-tier category typing**: `item_description: string` (free-form, captures the invoice's "货物或应税劳务、服务名称" / "Item" line) + `category: enum` (6 buckets) driving EF lookup.
- `quantity_kg: number | null` — model only fills when an explicit numeric weight appears on the invoice; otherwise stays null and the user / EF Matcher falls back to per-currency EF lookup using `amount_yuan`.
- `invoice_no: string | null` — preserved for future audit / 对账 (deduplication, reconciliation against vendor statements). Phase 1c doesn't use it; landing the field now is cheap and keeps the schema stable.
- Both extraction paths: text + vision, mirroring the prior 3 stages.
- ExtractionReview gets a 4th Field-block renderer (`PurchaseFields`) and a 4th initial-values builder.
- Stage dropdown on /documents (already auto-driven by `stages:list`) grows from 3 → 4 options with zero UI code change.
- File size note: after this sub-project, `ExtractionReview.tsx` will be ~620 LOC with 4-arm switches. **Spec §7 of the freight design explicitly defers the per-stage component split to after travel.v1 lands at the 5-stage mark**, so this design does NOT introduce that refactor.

**Explicitly OUT of scope** (deferred):

- Multiple line items as separate `activity_data` rows. A purchase invoice with 5 SKUs still produces ONE extraction with aggregate fields; the user manually splits in ActivityForm if needed. Going to a `line_items: array` shape is a Phase 2 data-model change (would require `activity_data` to gain a `parent_extraction_id` and ActivityForm to support multi-row submission) — far beyond Phase 1 scope.
- Multi-currency invoices. v1 assumes CNY. USD/EUR purchases (rare for the export-oriented Chinese factory persona) are a Phase 1.5 EF Matcher concern (currency conversion at EF lookup time).
- VAT breakdown, tax category code, payment terms, freight charges separately itemized. All deferred — model is instructed to ignore.
- Buyer-side identity (the user's own organization). Implicit — purchase = "we bought".
- Auto-deduplication via `invoice_no`. The field is captured for future use; today there's no uniqueness check across purchase extractions.

**Deliverable**: drag a real Chinese purchase invoice (增值税专用发票 or 普通发票 or 商业发票) into `/documents` → pick "Chinese purchase (采购发票)" from the stage dropdown → extraction populates the 9 fields → review pane shows them → Confirm opens ActivityForm prefilled (amount=weight if known else 1, unit=kg or CNY-equivalent, single-day, notes includes supplier + item_description + invoice_no) → user picks emission_source + EF → submit → activity_data row → dashboard CO2e ticks up.

## §2 — Schema

```ts
// src/main/llm/stages/purchase.ts

export const purchaseCategory = z.enum([
  'raw_material',   // 原材料: 钢 / 塑料粒子 / 化工原料 / 木材 / 纸浆
  'component',      // 零部件: PCB / 紧固件 / 阀门 / 模具 / 半成品
  'consumable',     // 消耗品: 包装材料 / 印刷材料 / 防护用品
  'office_supply',  // 办公用品: 文具 / 设备 / 耗材
  'service',        // 服务: 咨询 / 维修 / 设计 / 软件订阅
  'other',          // 不在以上桶 / 模型无法分类
]);
export type PurchaseCategory = z.infer<typeof purchaseCategory>;

export const purchaseExtraction = z.object({
  doc_type: z.literal('purchase').describe('Always the literal "purchase".'),
  supplier_name: z
    .string()
    .describe(
      'Seller / vendor name (the entity that issued the invoice). E.g. ' +
        '"宝山钢铁股份有限公司", "深圳市XX电子有限公司", "京东商城". ' +
        'Empty string if not legible.',
    ),
  item_description: z
    .string()
    .describe(
      'Free-text description of what was purchased — exactly as printed on the ' +
        'invoice "货物或应税劳务、服务名称" column. For multi-line invoices, ' +
        'concatenate the most prominent items with " / " (e.g. "热轧钢板 / ' +
        '冷轧钢板"). Empty string if not legible.',
    ),
  category: purchaseCategory.describe(
    'Coarse 6-bucket classification driving EF lookup. ' +
      'raw_material: 钢/塑料/化工/木材/纸浆 etc. ' +
      'component: PCB/紧固件/阀门/模具/半成品. ' +
      'consumable: 包装/印刷/防护. ' +
      'office_supply: 文具/办公设备/耗材. ' +
      'service: 咨询/维修/设计/订阅. ' +
      'other: 不能confidently 分类 (lower confidence).',
  ),
  quantity_kg: z
    .number()
    .min(0)
    .nullable()
    .describe(
      'Total quantity in KILOGRAMS, if the invoice gives an explicit weight ' +
        '(数量+单位 like "1500 kg" or "1.5 吨"). null if the invoice uses ' +
        'non-weight units (件/支/套/项/月) or service categories where weight ' +
        'is meaningless. The EF Matcher falls back to amount-based EFs when ' +
        'this is null.',
    ),
  amount_yuan: z
    .number()
    .min(0)
    .describe(
      'Total invoiced amount in CNY ("价税合计" / "Total" / "应付金额"). ' +
        'Includes VAT. Number only, no symbols. 0 if not legible.',
    ),
  occurred_at: z
    .string()
    .describe(
      'Invoice date as YYYY-MM-DD ("开票日期"). Purchase is a single-point ' +
        'event for accounting (both start and end set to this date). Empty ' +
        'string if not legible.',
    ),
  invoice_no: z
    .string()
    .nullable()
    .describe(
      'Invoice number ("发票号码" / 8-digit invoice serial). Used by future ' +
        'auto-dedup; null if absent.',
    ),
  confidence: z
    .enum(['high', 'medium', 'low'])
    .describe(
      'high: supplier_name + category + amount_yuan + occurred_at all clearly ' +
        'visible AND single dominant item type. ' +
        'medium: 1-2 fields inferred, OR multi-item invoice with heterogeneous ' +
        'categories where the model picked the most prominent. ' +
        'low: not a purchase invoice, OR multiple required fields are guesses, ' +
        'OR category=other.',
    ),
});

export type PurchaseExtraction = z.infer<typeof purchaseExtraction>;
```

**Schema philosophy** (identical to the prior 3 stages):
- Shape strict (8 keys always present).
- Values permissive (0 / empty / null accepted as "I cannot read this").
- 2 nullable fields: `quantity_kg` (often absent — service invoices, count-based units), `invoice_no` (preserved for audit, absent on some informal receipts).

**Why no `unit_price`**: purchase invoices show unit price per line item — once we aggregate to a single row, unit price loses meaning. Total amount + total weight is all the EF Matcher needs.

**Why no `currency` field**: v1 is CNY-only (95%+ of Chinese factory purchases). The `amount_yuan` naming makes the assumption explicit. Multi-currency support adds a `currency` enum + downstream conversion logic — out of scope.

## §3 — Prompt

Same DRY pattern as freight — a shared `FIELD_RULES` constant, two entry points (`buildPrompt(pdfText)` and `buildVisionMessages()`). Notable instructions to the model:

1. **Multi-line invoices**: "If the invoice has multiple line items (commonly: 一张发票 N 行明细), aggregate: pick the dominant category, concatenate the top 2-3 item descriptions with ' / ' separators, sum the quantities (kg) and amounts. Set confidence='medium' for multi-item invoices."
2. **Category mapping** with Chinese examples per bucket (mirrors fuel's category mapping).
3. **Weight unit normalization**: 吨 → kg ×1000, 克 → kg ÷1000.
4. **Non-weight units**: "If the invoice uses 件/支/套/项/张/月/年 etc. (count or time), set `quantity_kg = null`. Don't estimate weight from unit counts."
5. **Ignored fields**: tax breakdown ("税额", "税率"), payment terms, customs codes, freight charges within invoice ("运费" — that goes to a freight stage), buyer info (买方信息).
6. **Service purchases**: explicit `category='service'` for software subscriptions, consulting, design fees, maintenance contracts — `quantity_kg=null`, `amount_yuan` drives the EF lookup.

Example response (verbatim in the prompt):
```json
{"doc_type":"purchase","supplier_name":"宝山钢铁股份有限公司","item_description":"热轧钢板 5mm / 冷轧钢板 3mm","category":"raw_material","quantity_kg":7500,"amount_yuan":48650,"occurred_at":"2026-04-22","invoice_no":"12345678","confidence":"medium"}
```

## §4 — UX delta

| Place | Change |
|---|---|
| `/documents` upload zone | Stage dropdown auto-grows from 3 → 4 options. Zero code change (driven by `stages:list`). |
| `ExtractionReview` per-stage rendering | Add `PurchaseFields` component (8 field rows). Switch on `parsed.stage === 'purchase.v1'`. The existing 3-arm ternary becomes 4-arm. |
| `ExtractionReview` prefill builder | Add `buildPurchaseInitialValues(data, filename)`:<br>- if `quantity_kg` is a positive number → `amount=String(quantity_kg)`, `unit='kg'`<br>- else (null or 0) → `amount=String(amount_yuan)`, `unit='CNY'`<br>- `occurred_at_start=occurred_at_end=data.occurred_at`<br>- notes joins supplier + item_description + category + invoice_no (each only if non-empty) |
| `documents_review_field_*` i18n | 5 new keys: `item_description`, `category`, `quantity_kg`, `invoice_no`. (`supplier`, `amount_yuan`, `occurred_at`, `confidence` reuse existing keys.) Plus per-category translation labels? — NO: v1 renders the raw enum value (`raw_material` / `component` / ...). Localized category names are a Phase 1.5 polish item. |
| `ActivityForm` `unit='CNY'` support | Existing ActivityForm accepts any free-form `unit` string at the schema level. v1 uses `'CNY'` for amount-based purchase rows; the EF Matcher's per-currency EFs (Phase 1.5) will key on this. NO ActivityForm changes needed today. |

The per-stage spinner-flip, retry-after-discard-preserves-stage, parsed-state banner, and the `fuel_category='other'` warning chip pattern (we'll mirror that for `category='other'`) all work automatically for any registered stage.

**Category='other' warning chip**: same UX pattern as fuel_receipt — render a destructive-styled banner in the review pane when `parsed.stage === 'purchase.v1' && parsed.data.category === 'other'`, asking the user to override before Confirm. Reuses the existing i18n key from fuel? No — different domain. New key: `documents_review_purchase_category_other_warning`.

## §5 — File structure

| File | Status | Responsibility |
|---|---|---|
| `src/main/llm/stages/purchase.ts` | **create** | `purchaseCategory` enum (6 buckets), `purchaseExtraction` schema (8 fields), `PurchaseExtraction` type, `PurchaseCategory` type, `purchaseStage`. Mirrors fuel_receipt / freight structure. |
| `src/main/llm/stages/registry.ts` | modify | Add `purchaseStage` to the `_stageRegistry` Map (4th entry). |
| `tests/main/llm/stages/purchase.test.ts` | **create** | Mirror `freight.test.ts`: schema accept/reject boundaries (~13 tests), stage metadata (prompt content checks), registry integration. |
| `tests/main/llm/stages/registry.test.ts` | modify | Bump expected stage count 3 → 4; add `purchase.v1` to id-set assertions. |
| `messages/en.json`, `messages/zh-CN.json` | modify | 5 new keys (item_description, category, quantity_kg, invoice_no, category_other_warning). |
| `src/renderer/components/ExtractionReview.tsx` | modify | Add `PurchaseParsed` type, `PurchaseFields` subcomponent, `buildPurchaseInitialValues` builder, 4th arm in 2 ternaries. Also extend the existing `fuel_category='other'` warning logic to also fire on `purchase.category='other'`. **NO file refactor — that's Phase 1.5 prep after travel.v1.** |
| `tests/main/services/extraction-service.test.ts` | modify | One new smoke test for `purchase.v1` stage routing (mirrors fuel + freight smoke tests). |

## §6 — Testing

Same shape as the freight plan.

### Unit tests (vitest, no real LLM)

1. **`purchase.test.ts`** mirrors `freight.test.ts`:
   - Schema accepts happy-path.
   - Schema accepts both nullable fields (`quantity_kg`, `invoice_no`) set to null.
   - Schema accepts `amount_yuan: 0`, empty `supplier_name` / `item_description` / `occurred_at` (permissive contract).
   - Schema accepts non-ISO / empty `occurred_at`.
   - Schema rejects negative `quantity_kg`, `amount_yuan`.
   - Schema rejects unknown `category` value.
   - Schema accepts each of 6 valid `category` values (including `'other'`).
   - Schema rejects unknown `confidence` value.
   - Schema rejects `doc_type` other than `'purchase'`.
   - Stage metadata test (id, version, inputType, both prompt builders).
   - Prompt-content test: text path embeds `<invoice>${pdfText}</invoice>` (NOTE: spec uses `<invoice>` not `<receipt>` — the wrapper noun matches the document type for prompt clarity); both paths include "purchase invoice" / "category" / "service" / "raw_material" / example.
   - Registry integration: `getStage('purchase.v1') === purchaseStage`; `listStages()` returns all 4 ids.

2. **`registry.test.ts`** updated: 3 → 4.

3. **`extraction-service.test.ts`** gains one purchase smoke (analogous to fuel + freight smokes).

### Manual smoke (deferred to consolidated pre-tag verification)

Postponed to the phase-1d tag-time smoke. Will include:
- Real 增值税专用发票 (steel) → category='raw_material', quantity_kg populated → Confirm → activity_data.
- Real 商业发票 (office supplies) → category='office_supply', quantity_kg=null, amount_yuan drives prefill → Confirm.
- Multi-line invoice → category=dominant, item_description concatenated, confidence='medium'.
- Service invoice (software subscription) → category='service', quantity_kg=null.

## §7 — Risks & open questions

| Risk | Mitigation |
|---|---|
| `category` mis-classification on niche purchases (e.g. is "工业气体" a raw_material or consumable?) | Edge cases get `'other'` + confidence='low'. The warning banner forces user override before Confirm. After 50+ real invoices, iterate the enum if a 7th bucket emerges. |
| Multi-line invoices with heterogeneous categories (steel + bolts + freight) | Model picks dominant + sets `confidence='medium'`. User can split in ActivityForm if needed. Real users will tell us if this is a frequent pain point. |
| User has multi-currency invoices (USD imports, EUR services) | v1 doesn't support. Schema `amount_yuan` makes the assumption explicit. If real users hit this, Phase 1.5 EF Matcher adds a `currency` discriminator + FX conversion. |
| `invoice_no` collisions across vendors (some vendors don't number, others repeat) | Field is captured but NOT used for dedup in v1. Future dedup needs `supplier_name + invoice_no + occurred_at` composite key — out of scope. |
| ExtractionReview growing past ~620 LOC after this sub-project | Acknowledged in spec §1. The per-stage component split refactor happens after travel.v1 lands (5-stage mark) as Phase 1.5 prep. |
| ActivityForm `unit='CNY'` value isn't in any existing unit dropdown | The unit_definition table has CNY? Need to verify. If not, v1 manually types 'CNY' in the form's unit input. Phase 1.5 EF Matcher adds CNY as a real unit family with per-currency EFs. |

## §8 — Out-of-scope work explicitly deferred

- **Sub-project 4 (travel.v1)**: 4th stage. After it lands, ExtractionReview gets refactored into per-stage component files (Phase 1.5 prep).
- **Sub-project 5 (EF Matcher v1)**: FTS5 + LLM-recommended EF picker. Currency conversion + distance-API integration (for freight) + per-bucket EF refinement (for purchase + freight) all live here.
- **Phase 2 line-items array support**: requires `activity_data` table evolution (parent_extraction_id) and ActivityForm multi-row submission. Multi-line invoices stay aggregated in v1.
- **Auto-dedup via invoice_no**: needs a composite-key uniqueness check + UI conflict resolution. Phase 2.
- **Localized category labels**: today renders raw enum value. Phase 1.5 polish.
