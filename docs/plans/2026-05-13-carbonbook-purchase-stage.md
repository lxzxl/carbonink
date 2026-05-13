# `purchase.v1` Stage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the fourth extraction stage so Phase 1's "5 种典型单据" deliverable moves from 3/5 to 4/5. Users upload a Chinese purchase invoice (采购发票 / 增值税专用发票 / 商业发票), the AI extracts supplier / item description / category / quantity / amount / date, and the existing Confirm → ActivityForm → activity_data flow runs to completion.

**Architecture:** Single Stage<PurchaseExtraction> mirroring the prior 3 stages exactly. Two-tier category typing: free-form `item_description` (invoice's literal "货物或应税劳务、服务名称" line) + `category` enum (6 buckets) driving EF lookup. `quantity_kg` is nullable — when null (service invoices, count-based units), ActivityForm prefill falls back to amount_yuan with `unit='CNY'`. NO line-items array (Phase 2 work).

**Tech Stack:** TypeScript, AI SDK 6, zod, React 18, TanStack Router/Query, vitest, biome, paraglide i18n.

**Spec:** `docs/specs/2026-05-13-purchase-stage-design.md` (commit `2fba3dd`).

**Reference plan + shipped work:** `docs/plans/2026-05-13-carbonbook-freight-stage.md` (commit `f90b3f8`) — this plan mirrors its task ordering. Differences are domain-specific (schema, prompt, i18n keys) plus the ExtractionReview switch becomes 4-arm and gains an extended `category='other'` warning.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/main/llm/stages/purchase.ts` | **create** | `purchaseCategory` zod enum (6 values: raw_material/component/consumable/office_supply/service/other), `purchaseExtraction` zod object schema (8 fields), `PurchaseExtraction` inferred type, `PurchaseCategory` inferred type, `purchaseStage: Stage<PurchaseExtraction>` with `id='purchase.v1'`, `buildPrompt` (text path) + `buildVisionMessages` (vision path) sharing a private `FIELD_RULES` constant. |
| `src/main/llm/stages/registry.ts` | modify | Add `purchaseStage` to the `_stageRegistry` Map (4th entry). |
| `tests/main/llm/stages/purchase.test.ts` | **create** | Mirror `freight.test.ts`: schema accept/reject boundaries (~13 tests), stage metadata + prompt-content checks, registry integration. |
| `tests/main/llm/stages/registry.test.ts` | modify | Bump expected stage count 3 → 4 + add `purchase.v1` to id-set assertions. |
| `messages/en.json`, `messages/zh-CN.json` | modify | 5 new keys (item_description / category / quantity_kg / invoice_no / purchase_category_other_warning). |
| `src/renderer/components/ExtractionReview.tsx` | modify | Add `PurchaseParsed` type, `PurchaseFields` subcomponent, `buildPurchaseInitialValues` builder, 4th arm in 2 ternaries. Extend the existing `showFuelOtherWarning` boolean to also fire on `purchase.category === 'other'` (rename it to `showCategoryOtherWarning`). **NO file refactor — per-stage component split deferred to Phase 1.5 after travel.v1 lands.** File will land at ~620 LOC; this is intentional. |
| `tests/main/services/extraction-service.test.ts` | modify | One new smoke test mirroring fuel + freight smokes — verifies stage_id routing + schema reachability. |

---

## Task 1: `purchase.ts` schema + types

**Files:**
- Create: `src/main/llm/stages/purchase.ts`
- Test: `tests/main/llm/stages/purchase.test.ts`

Lands the schema + an empty stage shell. Prompt content arrives in Task 2.

- [ ] **Step 1: Write the failing schema tests**

Create `tests/main/llm/stages/purchase.test.ts`:

```ts
import {
  type PurchaseExtraction,
  purchaseExtraction,
  purchaseStage,
} from '@main/llm/stages/purchase';
import { describe, expect, it } from 'vitest';

const GOOD: PurchaseExtraction = {
  doc_type: 'purchase',
  supplier_name: '宝山钢铁股份有限公司',
  item_description: '热轧钢板 5mm / 冷轧钢板 3mm',
  category: 'raw_material',
  quantity_kg: 7500,
  amount_yuan: 48650,
  occurred_at: '2026-04-22',
  invoice_no: '12345678',
  confidence: 'medium',
};

describe('purchaseExtraction schema', () => {
  it('accepts a fully populated purchase JSON', () => {
    expect(purchaseExtraction.parse(GOOD)).toEqual(GOOD);
  });

  it('accepts the 2 nullable fields set to null (quantity_kg, invoice_no)', () => {
    const parsed = purchaseExtraction.parse({
      ...GOOD,
      quantity_kg: null,
      invoice_no: null,
    });
    expect(parsed.quantity_kg).toBeNull();
    expect(parsed.invoice_no).toBeNull();
  });

  it('accepts permissive zero values for amount_yuan', () => {
    expect(() => purchaseExtraction.parse({ ...GOOD, amount_yuan: 0 })).not.toThrow();
  });

  it('accepts quantity_kg = 0 (model reports "I cannot read")', () => {
    expect(() => purchaseExtraction.parse({ ...GOOD, quantity_kg: 0 })).not.toThrow();
  });

  it('accepts empty supplier_name / item_description (permissive)', () => {
    expect(() => purchaseExtraction.parse({ ...GOOD, supplier_name: '' })).not.toThrow();
    expect(() => purchaseExtraction.parse({ ...GOOD, item_description: '' })).not.toThrow();
  });

  it('accepts non-ISO / empty occurred_at strings (permissive)', () => {
    expect(() =>
      purchaseExtraction.parse({ ...GOOD, occurred_at: '2026/04/22' }),
    ).not.toThrow();
    expect(() => purchaseExtraction.parse({ ...GOOD, occurred_at: '' })).not.toThrow();
  });

  it('rejects negative quantity_kg', () => {
    expect(() => purchaseExtraction.parse({ ...GOOD, quantity_kg: -1 })).toThrow();
  });

  it('rejects negative amount_yuan', () => {
    expect(() => purchaseExtraction.parse({ ...GOOD, amount_yuan: -1 })).toThrow();
  });

  it('rejects an unknown category value', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
      purchaseExtraction.parse({ ...GOOD, category: 'machinery' } as any),
    ).toThrow();
  });

  it('accepts each of the 6 valid category values', () => {
    for (const category of [
      'raw_material',
      'component',
      'consumable',
      'office_supply',
      'service',
      'other',
    ] as const) {
      expect(() => purchaseExtraction.parse({ ...GOOD, category })).not.toThrow();
    }
  });

  it('rejects an unknown confidence value', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
      purchaseExtraction.parse({ ...GOOD, confidence: 'unsure' } as any),
    ).toThrow();
  });

  it('rejects a doc_type other than the literal "purchase"', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
      purchaseExtraction.parse({ ...GOOD, doc_type: 'fuel_receipt' } as any),
    ).toThrow();
  });
});

describe('purchaseStage metadata', () => {
  it('exposes id="purchase.v1", version, inputType, and prompt builders', () => {
    expect(purchaseStage.id).toBe('purchase.v1');
    expect(purchaseStage.version).toBe('1.0.0');
    expect(purchaseStage.inputType).toBe('pdf_text');
    expect(typeof purchaseStage.buildPrompt).toBe('function');
    expect(typeof purchaseStage.buildVisionMessages).toBe('function');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/llm/stages/purchase.test.ts --pool=threads
```
Expected: FAIL with "Cannot find module '@main/llm/stages/purchase'".

- [ ] **Step 3: Create the schema-only module**

Create `src/main/llm/stages/purchase.ts`:

```ts
import { z } from 'zod';
import type { Stage, VisionMessages } from './types.js';

/**
 * Coarse 6-bucket purchase category driving downstream EF lookup.
 * Covers Phase 1 scope for the export-oriented Chinese factory persona;
 * niche edge cases route to `'other'` + confidence='low' so the user
 * gets a manual override prompt at Confirm time (see
 * `documents_review_purchase_category_other_warning` in the review UI).
 *
 * Mapping intent (model gets this verbatim in the prompt):
 *   - 钢 / 塑料 / 化工 / 木材 / 纸浆 → 'raw_material'
 *   - PCB / 紧固件 / 阀门 / 模具 / 半成品 → 'component'
 *   - 包装材料 / 印刷材料 / 防护用品 → 'consumable'
 *   - 文具 / 办公设备 / 耗材 → 'office_supply'
 *   - 咨询 / 维修 / 设计 / 软件订阅 → 'service'
 *   - 无法 confidently 分类 → 'other'
 */
export const purchaseCategory = z.enum([
  'raw_material',
  'component',
  'consumable',
  'office_supply',
  'service',
  'other',
]);
export type PurchaseCategory = z.infer<typeof purchaseCategory>;

/**
 * Structured output schema for a Chinese purchase invoice
 * (采购发票 / 增值税专用发票 / 商业发票).
 *
 * Shape strict, values permissive — same contract as china_utility.v1,
 * fuel_receipt.v1, and freight.v1. Numeric fields use `.min(0)`. Two
 * nullable fields: `quantity_kg` (often absent on service / count-based
 * invoices) and `invoice_no` (preserved for future audit / dedup).
 *
 * Two-tier category typing mirrors fuel's pattern:
 * `item_description` preserves the invoice's literal "货物或应税劳务、服务名称"
 * text (audit + future regex-based EF refinement), `category` is the
 * 6-bucket EF discriminator.
 *
 * SINGLE AGGREGATE ROW — no line-items array. Multi-line invoices have
 * the model concatenate the top 2-3 items in `item_description` and
 * aggregate quantity_kg + amount_yuan. Going to a per-line shape would
 * require activity_data table evolution (parent_extraction_id) and is
 * deferred to Phase 2 per spec §1.
 */
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
      'other: cannot confidently bucket (lowers confidence).',
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
        'visible AND single dominant item type. medium: 1-2 fields inferred, ' +
        'OR multi-item invoice with heterogeneous categories where the model ' +
        'picked the most prominent. low: not a purchase invoice, OR multiple ' +
        'required fields are guesses, OR category=other.',
    ),
});

export type PurchaseExtraction = z.infer<typeof purchaseExtraction>;

/**
 * v1 Chinese-purchase stage. Mirrors `freightStage` structure:
 * one schema, one text-path prompt, one vision-path prompt, both
 * sharing a private FIELD_RULES const.
 *
 * Prompt body lands in Task 2; this stub exists so the registry wiring
 * + metadata tests can pass first.
 */
export const purchaseStage: Stage<PurchaseExtraction> = {
  id: 'purchase.v1',
  version: '1.0.0',
  description: 'Chinese purchase invoice (采购发票) — classify + extract',
  inputType: 'pdf_text',
  schema: purchaseExtraction,
  buildPrompt: (_pdfText: string) => '__PROMPT_PENDING_TASK_2__',
  buildVisionMessages: (): VisionMessages => ({
    userText: '__VISION_PROMPT_PENDING_TASK_2__',
  }),
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/llm/stages/purchase.test.ts --pool=threads
pnpm typecheck
```
Expected: 13 tests passing (12 schema + 1 metadata). typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/main/llm/stages/purchase.ts tests/main/llm/stages/purchase.test.ts
git commit -m "feat(stages): purchase.v1 — schema + stage shell"
```

---

## Task 2: `purchase.ts` prompts (text + vision)

**Files:**
- Modify: `src/main/llm/stages/purchase.ts`
- Test: `tests/main/llm/stages/purchase.test.ts`

- [ ] **Step 1: Add prompt-content assertions to the metadata test**

Open `tests/main/llm/stages/purchase.test.ts`. Replace the existing single `it('exposes id="purchase.v1"...')` test inside `describe('purchaseStage metadata', ...)` with these three assertions:

```ts
describe('purchaseStage metadata', () => {
  it('exposes id="purchase.v1", version, inputType, and prompt builders', () => {
    expect(purchaseStage.id).toBe('purchase.v1');
    expect(purchaseStage.version).toBe('1.0.0');
    expect(purchaseStage.inputType).toBe('pdf_text');
    expect(typeof purchaseStage.buildPrompt).toBe('function');
    expect(typeof purchaseStage.buildVisionMessages).toBe('function');
  });

  it('buildPrompt embeds the PDF text inside <invoice>...</invoice> AND includes field rules', () => {
    const prompt = purchaseStage.buildPrompt('SAMPLE_PURCHASE_TEXT_TOKEN');
    expect(prompt).toContain('Chinese purchase invoice');
    expect(prompt).toContain('SAMPLE_PURCHASE_TEXT_TOKEN');
    expect(prompt).toContain('<invoice>');
    expect(prompt).toContain('</invoice>');
    // Field rules verbatim shared with vision path.
    expect(prompt).toContain('category');
    expect(prompt).toContain('quantity_kg');
    // Each of the 6 category enum values appears in the prompt body.
    expect(prompt).toContain('raw_material');
    expect(prompt).toContain('component');
    expect(prompt).toContain('consumable');
    expect(prompt).toContain('office_supply');
    expect(prompt).toContain('service');
    // The multi-line aggregation instruction.
    expect(prompt).toContain('aggregate');
  });

  it('buildVisionMessages mirrors buildPrompt field rules but omits the <invoice> placeholder', () => {
    const msgs = purchaseStage.buildVisionMessages?.();
    expect(msgs).toBeDefined();
    expect(msgs?.userText).toContain('Chinese purchase invoice');
    expect(msgs?.userText).toContain('category');
    expect(msgs?.userText).toContain('quantity_kg');
    expect(msgs?.userText).toContain('raw_material');
    expect(msgs?.userText).toContain('aggregate');
    // No PDF text placeholder — image content is appended by the caller.
    expect(msgs?.userText).not.toContain('<invoice>');
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/llm/stages/purchase.test.ts --pool=threads
```
Expected: 12 schema tests still pass; 2 of the 3 metadata tests fail (the prompt-content assertions).

- [ ] **Step 3: Replace the stub prompts with the real ones**

In `src/main/llm/stages/purchase.ts`, replace the entire `purchaseStage` export at the bottom (everything from the JSDoc comment above `export const purchaseStage` onward) with:

```ts
/**
 * Field-mapping + output-format rules shared between `buildPrompt`
 * (text path) and `buildVisionMessages` (image path). Extracting this
 * to a const guarantees the two paths stay aligned. Same DRY pattern as
 * china_utility.v1, fuel_receipt.v1, and freight.v1.
 */
const FIELD_RULES = `Output rules (CRITICAL — DeepSeek and other providers without native JSON
schema mode read these directly):
- Return EXACTLY ONE JSON object, no markdown, no \`\`\`json fences, no prose.
- Every required field must be present. Numeric fields are numbers (not
  strings). Date fields are strings in ISO format "YYYY-MM-DD".
- If a value is genuinely missing on the invoice, use null ONLY for the
  two fields explicitly marked nullable (quantity_kg, invoice_no).
  Never omit a key. Never use null for required fields — emit a
  best-guess instead with confidence='low'.

Multi-line invoices: many Chinese purchase invoices show several line
items (different SKUs on one invoice). When that happens, AGGREGATE
into a single row:
  - item_description: concatenate the top 2-3 most prominent items
    with " / " separators (e.g. "热轧钢板 5mm / 冷轧钢板 3mm").
  - category: pick the dominant category (the one matching most line
    items by value). If genuinely mixed, use 'other' + confidence='low'.
  - quantity_kg: sum the kg quantities across lines. If some lines use
    non-weight units, leave quantity_kg=null entirely (don't partial-sum).
  - amount_yuan: total invoice amount ("价税合计").
  - Set confidence='medium' for any multi-line aggregation.

Field mapping:
- doc_type: always "purchase".
- supplier_name: the SELLER (the entity that issued the invoice). E.g.
  "宝山钢铁股份有限公司" / "深圳市XX电子有限公司" / "京东商城".
- item_description: free-text item name(s) from the "货物或应税劳务、
  服务名称" column. Verbatim as printed (Chinese characters preserved).
- category: 6-bucket classification.
  - raw_material:  钢 / 塑料粒子 / 化工原料 / 木材 / 纸浆 / 金属原料
  - component:     PCB / 紧固件 / 阀门 / 模具 / 半成品 / 装配件
  - consumable:    包装材料 / 印刷品 / 防护用品 / 工业耗材
  - office_supply: 文具 / 办公设备 / 办公耗材 / 家具
  - service:       咨询 / 维修 / 设计 / 软件订阅 / 培训 / 法律服务
  - other:         cannot confidently bucket (e.g. mixed multi-line),
                   also set confidence='low'.
- quantity_kg: numeric KILOGRAMS, ONLY if invoice has explicit weight.
  - "千克" / "kg" / "公斤" → direct.
  - "吨" / "T" → multiply by 1000.
  - "克" / "g" → divide by 1000.
  - "件" / "支" / "套" / "张" / "项" / "月" / "年" → null (NOT a weight).
  - Service categories → null.
- amount_yuan: numeric CNY total ("价税合计" / "Total" / "应付金额").
  Number only, no "¥" / "元" / "CNY". 0 if not legible.
- occurred_at: invoice date ("开票日期") as ISO YYYY-MM-DD. If only
  year-month shown ("2026-04"), assume the 15th. Empty string if not
  legible.
- invoice_no: invoice number ("发票号码" — usually 8 digits on
  增值税专用发票). null if absent.
- confidence:
  - "high" if supplier_name, category, amount_yuan, occurred_at are all
    clearly visible AND single dominant item type.
  - "medium" if multi-line aggregation was applied, OR a unit conversion
    (吨 → kg) was applied, OR 1-2 fields were inferred.
  - "low" if the document doesn't look like a purchase invoice at all,
    OR multiple required fields are guesses, OR category=other.

Ignore (DO NOT include in the output): VAT breakdown (税额 / 税率),
payment terms, buyer info (买方名称 / 纳税人识别号 — that's the user's
own org), customs declaration code, line-level discounts, freight
charges that appear as a separate invoice line (that's a freight stage
concern, not purchase), bank account info.

Example valid response shape (do not copy values — extract from the
real invoice):
{"doc_type":"purchase","supplier_name":"宝山钢铁股份有限公司","item_description":"热轧钢板 5mm / 冷轧钢板 3mm","category":"raw_material","quantity_kg":7500,"amount_yuan":48650,"occurred_at":"2026-04-22","invoice_no":"12345678","confidence":"medium"}`;

/**
 * v1 Chinese-purchase stage. Mirrors `freightStage`:
 * - same Stage<T> shape;
 * - text path uses <invoice>${pdfText}</invoice> wrapper (the noun
 *   matches the document type; prior stages used <bill> for utility,
 *   <receipt> for fuel + freight, <invoice> for purchase);
 * - vision path swaps the wrapper for an "images attached" hint and
 *   reuses FIELD_RULES verbatim;
 * - prompt is in English (instruction-following) while the invoice
 *   content stays Chinese.
 */
export const purchaseStage: Stage<PurchaseExtraction> = {
  id: 'purchase.v1',
  version: '1.0.0',
  description: 'Chinese purchase invoice (采购发票) — classify + extract',
  inputType: 'pdf_text',
  schema: purchaseExtraction,
  buildPrompt: (pdfText: string) => `
You are extracting structured data from a Chinese purchase invoice (采购发票 / 增值税专用发票 / 商业发票).

Invoice text (extracted from PDF):
<invoice>
${pdfText}
</invoice>

${FIELD_RULES}`,
  buildVisionMessages: (): VisionMessages => ({
    userText: `You are extracting structured data from a Chinese purchase invoice (采购发票 / 增值税专用发票 / 商业发票).

The invoice is provided as one or more PNG images (one per PDF page) attached to this
message. Look at the images directly — do NOT request OCR text from another tool.

If the PDF shows multiple invoices batched together (rare — usually one invoice per
PDF), extract the most prominent / first one and set confidence='low'.

${FIELD_RULES}`,
  }),
};
```

- [ ] **Step 4: Run all tests to confirm green**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/llm/stages/purchase.test.ts --pool=threads
pnpm typecheck
```
Expected: 15 tests passing (12 schema + 3 metadata). typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/main/llm/stages/purchase.ts tests/main/llm/stages/purchase.test.ts
git commit -m "feat(stages): purchase.v1 — text + vision prompts with shared FIELD_RULES"
```

---

## Task 3: Register `purchaseStage`

**Files:**
- Modify: `src/main/llm/stages/registry.ts`
- Modify: `tests/main/llm/stages/registry.test.ts`
- Test: append to `tests/main/llm/stages/purchase.test.ts`

- [ ] **Step 1: Add a registration test**

Open `tests/main/llm/stages/purchase.test.ts`. Append at the end of the file:

```ts
describe('purchaseStage registry integration', () => {
  it('is returned by getStage("purchase.v1")', () => {
    expect(getStage('purchase.v1')).toBe(purchaseStage);
  });

  it('appears in listStages() alongside the existing 3 stages', () => {
    const ids = listStages().map((s) => s.id);
    expect(ids).toContain('purchase.v1');
    expect(ids).toContain('freight.v1');
    expect(ids).toContain('fuel_receipt.v1');
    expect(ids).toContain('china_utility.v1');
  });
});
```

Hoist the `import { getStage, listStages } from '@main/llm/stages/registry'` import up to the file's top import block.

- [ ] **Step 2: Update the existing registry test to expect 4 stages**

Open `tests/main/llm/stages/registry.test.ts`. Read the existing assertions — after freight landed they expect 3 stages. Update each:

1. Any `stageRegistry.size === 3` or `listStages().length === 3` assertion → `=== 4`.
2. Any id-set assertion including the existing 3 ids → also include `'purchase.v1'`.
3. Test names mentioning "3 stages" → update to "4 stages" / "all registered stages".

DO NOT add a `purchaseStage` import unless one of the new assertions actually uses the reference directly (the prior freight task taught us that the unused import is a real lint error). Just add `'purchase.v1'` to the string-based id-set assertions.

- [ ] **Step 3: Run tests to verify the new ones fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/llm/stages/purchase.test.ts tests/main/llm/stages/registry.test.ts --pool=threads
```
Expected: 15 prior purchase tests still pass; 2 new registry-integration tests fail. registry.test.ts updates from Step 2 also fail until Step 4.

- [ ] **Step 4: Add the registry entry**

Open `src/main/llm/stages/registry.ts`. Current state (after freight landed):
```ts
import { chinaUtilityStage } from './china-utility.js';
import { freightStage } from './freight.js';
import { fuelReceiptStage } from './fuel-receipt.js';
import type { Stage } from './types.js';

const _stageRegistry = new Map<string, Stage>([
  [chinaUtilityStage.id, chinaUtilityStage as Stage],
  [fuelReceiptStage.id, fuelReceiptStage as Stage],
  [freightStage.id, freightStage as Stage],
]);
```

Replace ONLY the imports + Map literal with:
```ts
import { chinaUtilityStage } from './china-utility.js';
import { freightStage } from './freight.js';
import { fuelReceiptStage } from './fuel-receipt.js';
import { purchaseStage } from './purchase.js';
import type { Stage } from './types.js';

const _stageRegistry = new Map<string, Stage>([
  [chinaUtilityStage.id, chinaUtilityStage as Stage],
  [fuelReceiptStage.id, fuelReceiptStage as Stage],
  [freightStage.id, freightStage as Stage],
  [purchaseStage.id, purchaseStage as Stage],
]);
```

Leave the rest of the file UNCHANGED.

- [ ] **Step 5: Run all tests to confirm green**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads
pnpm typecheck
```
Expected: 346 tests passing (344 from prior + 2 new). typecheck clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/main/llm/stages/registry.ts \
        tests/main/llm/stages/purchase.test.ts \
        tests/main/llm/stages/registry.test.ts
git commit -m "feat(stages): register purchase.v1 in stage registry"
```

---

## Task 4: i18n strings

**Files:**
- Modify: `messages/en.json`
- Modify: `messages/zh-CN.json`

Add 5 new keys. The 8 fields fully covered by existing keys: `supplier` (existing `documents_review_field_supplier`), `amount_yuan` (existing), `occurred_at` (existing `documents_review_field_occurred_at`), `confidence` (existing); the remaining 4 fields need new keys, plus 1 warning key.

- [ ] **Step 1: Validate JSON is well-formed before edits**

```bash
cd /Users/lxz/ws/personal/carbonbook
node -e "JSON.parse(require('fs').readFileSync('messages/en.json', 'utf8')); JSON.parse(require('fs').readFileSync('messages/zh-CN.json', 'utf8')); console.log('OK');"
```
Expected: `OK`.

- [ ] **Step 2: Add new keys to en.json**

Open `messages/en.json`. Find the existing line `"documents_review_field_tracking_no": "Tracking no.",` (added by freight Task 4) and INSERT the following 5 keys IMMEDIATELY AFTER it:

```json
  "documents_review_field_item_description": "Item description",
  "documents_review_field_category": "Category",
  "documents_review_field_quantity_kg": "Quantity (kg)",
  "documents_review_field_invoice_no": "Invoice no.",
  "documents_review_purchase_category_other_warning": "Item category couldn't be classified — please override manually before Confirm.",
```

- [ ] **Step 3: Add new keys to zh-CN.json**

Open `messages/zh-CN.json`. Find the existing line `"documents_review_field_tracking_no": "运单/箱号",` and INSERT the following 5 keys IMMEDIATELY AFTER it:

```json
  "documents_review_field_item_description": "货物名称",
  "documents_review_field_category": "类别",
  "documents_review_field_quantity_kg": "数量（kg）",
  "documents_review_field_invoice_no": "发票号",
  "documents_review_purchase_category_other_warning": "无法自动分类货物类别——请在确认前手动调整。",
```

- [ ] **Step 4: Validate JSON + force paraglide regen**

```bash
cd /Users/lxz/ws/personal/carbonbook
node -e "JSON.parse(require('fs').readFileSync('messages/en.json', 'utf8')); JSON.parse(require('fs').readFileSync('messages/zh-CN.json', 'utf8')); console.log('OK');"
pnpm exec paraglide-js compile --project ./project.inlang --outdir ./src/renderer/paraglide
pnpm typecheck
```
Expected: `OK`, paraglide regenerates without warnings, typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add messages/en.json messages/zh-CN.json src/renderer/paraglide
git commit -m "feat(i18n): purchase field labels + category-other warning"
```

---

## Task 5: `ExtractionReview` — 4th arm + extended other-warning

**Files:**
- Modify: `src/renderer/components/ExtractionReview.tsx`

⚠️ **DO NOT REFACTOR**: the file will land at ~620 LOC after this task. **That is intentional**. Per-stage component splitting is explicitly deferred to Phase 1.5 (the refactor happens AFTER travel.v1 lands at the 5-stage mark, BEFORE EF Matcher). Just add a 4th arm to the existing ternaries — do NOT pull `ChinaUtilityFields`, `FuelReceiptFields`, `FreightFields`, `PurchaseFields` into separate files.

You're adding:
- `PurchaseParsed` type (4th type)
- `PurchaseFields` subcomponent (4th Field-block)
- `buildPurchaseInitialValues` builder (4th prefill)
- 4th arm in 2 ternaries (field block JSX + initialValues JSX)
- Extending the existing `showFuelOtherWarning` to ALSO fire on purchase.category='other' — rename to `showCategoryOtherWarning` and use the new i18n key, with branch-aware message selection.

The current file (after freight Task 5 = commit `707496b`) has 3 parsed types, 3 Field-block subcomponents, 3 initial-values builders, 3-arm ternaries, and a `showFuelOtherWarning` boolean.

- [ ] **Step 1: Add `PurchaseParsed` type and extend the discriminated union**

Find the existing `FreightParsed` type. Append `PurchaseParsed` immediately AFTER it (before the `type StageParsed = ...` line):

```ts
type PurchaseParsed = {
  doc_type?: string;
  supplier_name?: string;
  item_description?: string;
  category?:
    | 'raw_material'
    | 'component'
    | 'consumable'
    | 'office_supply'
    | 'service'
    | 'other';
  quantity_kg?: number | null;
  amount_yuan?: number;
  occurred_at?: string;
  invoice_no?: string | null;
  confidence?: 'high' | 'medium' | 'low';
};
```

Then extend the `StageParsed` discriminated union. Find:
```ts
type StageParsed =
  | { stage: 'china_utility.v1'; data: ChinaUtilityParsed }
  | { stage: 'fuel_receipt.v1'; data: FuelReceiptParsed }
  | { stage: 'freight.v1'; data: FreightParsed };
```

Replace with:
```ts
type StageParsed =
  | { stage: 'china_utility.v1'; data: ChinaUtilityParsed }
  | { stage: 'fuel_receipt.v1'; data: FuelReceiptParsed }
  | { stage: 'freight.v1'; data: FreightParsed }
  | { stage: 'purchase.v1'; data: PurchaseParsed };
```

- [ ] **Step 2: Extend the `parseExtraction` switch**

Find:
```ts
  if (promptVersion === 'freight.v1') {
    return { stage: 'freight.v1', data: obj as FreightParsed };
  }
  return null;
```

Replace with:
```ts
  if (promptVersion === 'freight.v1') {
    return { stage: 'freight.v1', data: obj as FreightParsed };
  }
  if (promptVersion === 'purchase.v1') {
    return { stage: 'purchase.v1', data: obj as PurchaseParsed };
  }
  return null;
```

- [ ] **Step 3: Add `PurchaseFields` subcomponent**

Find the existing `FreightFields` function (in the `Per-stage <dl> field blocks` section). Append immediately AFTER it:

```tsx
function PurchaseFields({ data }: { data: PurchaseParsed }) {
  return (
    <dl className="grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-4">
      <Field label={m.documents_review_field_supplier()} value={data.supplier_name} />
      <Field
        label={m.documents_review_field_item_description()}
        value={data.item_description}
      />
      <Field label={m.documents_review_field_category()} value={data.category} />
      <Field
        label={m.documents_review_field_quantity_kg()}
        value={typeof data.quantity_kg === 'number' ? `${data.quantity_kg} kg` : undefined}
      />
      <Field
        label={m.documents_review_field_amount_yuan()}
        value={typeof data.amount_yuan === 'number' ? `¥${data.amount_yuan}` : undefined}
      />
      <Field label={m.documents_review_field_occurred_at()} value={data.occurred_at} />
      <Field label={m.documents_review_field_invoice_no()} value={data.invoice_no} />
    </dl>
  );
}
```

- [ ] **Step 4: Add `buildPurchaseInitialValues` builder**

Find the existing `buildFreightInitialValues` function (in the `ActivityForm prefill builders (per stage)` section). Append immediately AFTER it:

```ts
/**
 * Purchase prefill: dual-track based on whether quantity_kg is known.
 *
 * If the invoice gave an explicit weight (`quantity_kg > 0`), prefill
 * `amount=String(quantity_kg)` with `unit='kg'` — EF Matcher will pick
 * a per-kg EF (e.g. embodied CO2e of steel per kg).
 *
 * If `quantity_kg` is null OR 0 (service invoices, count-based units,
 * unreadable weight), prefill `amount=String(amount_yuan)` with
 * `unit='CNY'` — EF Matcher (Phase 1.5) will pick a per-currency EF
 * (e.g. CO2e per ¥1 of office supplies / consulting services).
 *
 * Single-day event (purchase = invoice issue date), so
 * occurred_at_start = end.
 */
function buildPurchaseInitialValues(
  data: PurchaseParsed,
  filename: string,
): import('@renderer/components/ActivityForm').ActivityFormInitialValues {
  const notesParts = [`Auto-extracted from: ${filename}`];
  if (data.supplier_name) notesParts.push(`Supplier: ${data.supplier_name}`);
  if (data.item_description) notesParts.push(`Items: ${data.item_description}`);
  if (data.category) notesParts.push(`Category: ${data.category}`);
  if (data.invoice_no) notesParts.push(`Invoice: ${data.invoice_no}`);

  const hasWeight = typeof data.quantity_kg === 'number' && data.quantity_kg > 0;
  const out: import('@renderer/components/ActivityForm').ActivityFormInitialValues = {
    unit: hasWeight ? 'kg' : 'CNY',
    notes: notesParts.join(' · '),
  };
  if (data.occurred_at) {
    out.occurred_at_start = data.occurred_at;
    out.occurred_at_end = data.occurred_at;
  }
  if (hasWeight) {
    out.amount = String(data.quantity_kg);
  } else if (typeof data.amount_yuan === 'number') {
    out.amount = String(data.amount_yuan);
  }
  return out;
}
```

- [ ] **Step 5: Extend the field-block JSX ternary to 4 arms**

Find the existing JSX block:
```tsx
        {parsed.stage === 'china_utility.v1' ? (
          <ChinaUtilityFields data={parsed.data} />
        ) : parsed.stage === 'fuel_receipt.v1' ? (
          <FuelReceiptFields data={parsed.data} />
        ) : (
          <FreightFields data={parsed.data} />
        )}
```

Replace with:
```tsx
        {parsed.stage === 'china_utility.v1' ? (
          <ChinaUtilityFields data={parsed.data} />
        ) : parsed.stage === 'fuel_receipt.v1' ? (
          <FuelReceiptFields data={parsed.data} />
        ) : parsed.stage === 'freight.v1' ? (
          <FreightFields data={parsed.data} />
        ) : (
          <PurchaseFields data={parsed.data} />
        )}
```

- [ ] **Step 6: Extend the `initialValues` ternary to 4 arms**

Find:
```tsx
          initialValues={
            parsed.stage === 'china_utility.v1'
              ? buildChinaUtilityInitialValues(parsed.data, document.filename)
              : parsed.stage === 'fuel_receipt.v1'
                ? buildFuelReceiptInitialValues(parsed.data, document.filename)
                : buildFreightInitialValues(parsed.data, document.filename)
          }
```

Replace with:
```tsx
          initialValues={
            parsed.stage === 'china_utility.v1'
              ? buildChinaUtilityInitialValues(parsed.data, document.filename)
              : parsed.stage === 'fuel_receipt.v1'
                ? buildFuelReceiptInitialValues(parsed.data, document.filename)
                : parsed.stage === 'freight.v1'
                  ? buildFreightInitialValues(parsed.data, document.filename)
                  : buildPurchaseInitialValues(parsed.data, document.filename)
          }
```

- [ ] **Step 7: Extend the `category='other'` warning chip**

Find the existing block (after the field grid, before the parsed-status branch):

```tsx
  // fuel-only warning: the model selected "other" because it couldn't
  // confidently bucket the fuel. The user MUST override before this
  // gets to ActivityForm because the EF lookup needs a known category.
  const showFuelOtherWarning =
    parsed.stage === 'fuel_receipt.v1' && parsed.data.fuel_category === 'other';
```

Replace with:
```tsx
  // Warning when the model selected "other" because it couldn't confidently
  // bucket the document — fires for fuel_receipt's fuel_category AND
  // purchase's category. The user MUST override before this gets to
  // ActivityForm because the EF lookup needs a known category. The message
  // is category-specific so the user knows which field needs attention.
  const showCategoryOtherWarning =
    (parsed.stage === 'fuel_receipt.v1' && parsed.data.fuel_category === 'other') ||
    (parsed.stage === 'purchase.v1' && parsed.data.category === 'other');
  const categoryOtherWarningMessage =
    parsed.stage === 'purchase.v1'
      ? m.documents_review_purchase_category_other_warning()
      : m.documents_review_fuel_category_other_warning();
```

Then find the existing JSX block that renders the warning:

```tsx
        {showFuelOtherWarning && (
          <div className="mt-3 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {m.documents_review_fuel_category_other_warning()}
          </div>
        )}
```

Replace with:
```tsx
        {showCategoryOtherWarning && (
          <div className="mt-3 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {categoryOtherWarningMessage}
          </div>
        )}
```

- [ ] **Step 8: Verify typecheck + lint + tests**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run --pool=threads 2>&1 | tail -5
pnpm lint --max-diagnostics=80 2>&1 | grep "ExtractionReview" | head
wc -l src/renderer/components/ExtractionReview.tsx
```

Expected:
- typecheck: clean (TypeScript narrows `parsed.data` correctly via the 4-arm discriminated union)
- vitest: 346 tests still passing (no test added/removed in this task)
- lint: no new errors on ExtractionReview.tsx
- File LOC: ~620 (no refactor — single file expected)

- [ ] **Step 9: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/renderer/components/ExtractionReview.tsx
git commit -m "feat(ui): ExtractionReview — add purchase.v1 4th arm + extend category-other warning"
```

---

## Task 6: Integration smoke — orchestrator routes purchase.v1

**Files:**
- Modify: `tests/main/services/extraction-service.test.ts`

- [ ] **Step 1: Add the test**

Open `tests/main/services/extraction-service.test.ts`. Find the closing `});` of the top-level `describe('ExtractionService', () => { ... });` block (the file's penultimate line). Append this test immediately before the closing `});`:

```ts
  it('run() routes purchase.v1 through the same pipeline (stage lookup + INSERT)', async () => {
    const purchaseOutput = {
      doc_type: 'purchase' as const,
      supplier_name: '宝山钢铁股份有限公司',
      item_description: '热轧钢板 5mm / 冷轧钢板 3mm',
      category: 'raw_material' as const,
      quantity_kg: 7500,
      amount_yuan: 48650,
      occurred_at: '2026-04-22',
      invoice_no: '12345678',
      confidence: 'medium' as const,
    };

    h.cleanup();
    h = setupHarness();
    h.llmClient = {
      extract: vi.fn().mockResolvedValue(purchaseOutput),
      extractWithImages: vi.fn(),
    } as unknown as LLMClient;

    h.extractionService = new ExtractionService({
      db: h.db,
      now: () => '2026-05-13T00:00:00.000Z',
      documentService: h.documentService,
      settingsService: h.settingsService,
      llmClient: h.llmClient,
      readFile: () => Buffer.from('purchase-pdf-bytes'),
      parsePdf: vi.fn(async () => ({ text: 'FAKE_PURCHASE_TEXT' })),
    });

    const doc = uploadFakePdf(h.documentService);

    const ext = await h.extractionService.run({
      document_id: doc.id,
      stage_id: 'purchase.v1',
    });

    expect(ext.status).toBe('review_needed');
    expect(ext.prompt_version).toBe('purchase.v1');
    expect(JSON.parse(ext.parsed_json ?? '')).toEqual(purchaseOutput);
    expect(h.llmClient.extract).toHaveBeenCalledTimes(1);
    // Schema captured at the call site can parse the purchase output —
    // proves the orchestrator passed purchase.v1's schema, not another
    // stage's. Mirrors the technique used for fuel_receipt / freight smokes.
    const [, schema] = vi.mocked(h.llmClient.extract).mock.calls[0] ?? [];
    expect(schema).toBeDefined();
    expect(() => (schema as { parse: (x: unknown) => unknown }).parse(purchaseOutput)).not.toThrow();
  });
```

- [ ] **Step 2: Run the test to confirm it passes**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/services/extraction-service.test.ts --pool=threads
```
Expected: all existing extraction-service tests pass + 1 new = total 20 in this file.

- [ ] **Step 3: Run the full suite**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -5
```
Expected: 347 tests passing (346 from prior + 1 new).

- [ ] **Step 4: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add tests/main/services/extraction-service.test.ts
git commit -m "test(extraction): smoke test for purchase.v1 stage routing"
```

---

## Task 7: Full test + lint sweep

**Files:** none — verification only.

- [ ] **Step 1: Run the full suite**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads
```
Expected: ≥347 tests passing.

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
```
Expected: clean exit (no output).

- [ ] **Step 3: Run lint + format**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm format && pnpm lint --max-diagnostics=80
```
Expected: format may rewrite a few lines (commit them); lint shows only pre-existing `noNonNullAssertion` warnings and **0 errors**.

If format made changes, commit them:
```bash
cd /Users/lxz/ws/personal/carbonbook
git diff --stat
git add -A
git commit -m "chore: biome format pass for purchase stage"
```

(If `git diff --stat` shows no changes, skip the commit.)

- [ ] **Step 4: Verify branch state**

```bash
cd /Users/lxz/ws/personal/carbonbook
git branch --show-current
git log --oneline -10
```
Expected: `main` (not detached). Recent log shows the 7 task commits (plus any format commit) for this sub-project.

If `git branch --show-current` returns empty (detached HEAD — happened during sub-project 1), recover:
```bash
git checkout -B main
```

---

## Closeout

Sub-project 3 of 5 (purchase.v1) lands on `main` with NO tag — the `phase-1d` tag is reserved for after all 4 stages + EF Matcher land.

Expected end state:
- ≥347 vitest tests passing (`344 + 2 registry + 1 smoke`, plus the schema/metadata tests in purchase.test.ts which already counted via the per-task counts).
- 4 stages registered (`china_utility.v1`, `fuel_receipt.v1`, `freight.v1`, `purchase.v1`).
- Upload stage dropdown auto-grows to 4 options (zero UI code change).
- ExtractionReview renders per-stage fields for all 4 stages, including the unified `category='other'` warning chip for fuel + purchase.
- ExtractionReview is at ~620 LOC; **per-stage component split DEFERRED** to Phase 1.5 prep (after travel.v1 lands at 5-stage mark, BEFORE EF Matcher v1).

Manual smoke is DEFERRED to the consolidated pre-tag verification — does not run after each sub-project. The phase-1d tag-time smoke covers all 5 doc types end-to-end.

Next sub-project (4 of 5): `travel.v1`. Same brainstorm → spec → plan → execute cycle.
