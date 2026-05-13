# `fuel_receipt.v1` Stage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the second extraction stage so Phase 1's "5 种典型单据" deliverable moves from 1/5 to 2/5. Users upload a Chinese gas-station receipt (text-layer or scanned), the AI extracts fuel type / volume / supplier / date / amount, and the existing Confirm → ActivityForm → activity_data flow runs to completion.

**Architecture:** Stage Registry pattern is already mature. The new `fuelReceiptStage` mirrors `chinaUtilityStage` exactly — schema + `buildPrompt` + `buildVisionMessages` + a registry entry. The only renderer-side changes are (a) a stage dropdown on the upload zone driven by the existing `stages:list` IPC, (b) `ExtractionReview` switching on `extraction.prompt_version` to render the right field set, (c) new i18n keys + a fuel-specific `buildInitialValues` helper for ActivityForm prefill.

**Tech Stack:** TypeScript, AI SDK 6, zod, React 18, TanStack Router/Query, vitest, biome, paraglide i18n.

**Spec:** `docs/specs/2026-05-13-fuel-receipt-stage-design.md` (commit `31e76b7`).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/main/llm/stages/fuel-receipt.ts` | **create** | `fuelCategory` enum (8 buckets), `fuelReceiptExtraction` zod schema, `FuelReceiptExtraction` inferred type, exported `fuelReceiptStage: Stage<FuelReceiptExtraction>` with `id='fuel_receipt.v1'`, `buildPrompt` (text path), `buildVisionMessages` (vision path), both sharing a private `FIELD_RULES` constant. |
| `src/main/llm/stages/registry.ts` | modify | Add `fuelReceiptStage` to the `_stageRegistry` Map. One-line change. |
| `tests/main/llm/stages/fuel-receipt.test.ts` | **create** | Mirror `china-utility.test.ts`: happy-path schema parse, nullable fields, permissive-value cases (zero / empty), boundary rejections, stage metadata (id/version/buildPrompt content/buildVisionMessages content). |
| `messages/en.json`, `messages/zh-CN.json` | modify | Add 6 field-label keys + 1 stage-picker-hint key + 1 fuel-category-warning key. |
| `src/renderer/components/DocumentsUpload.tsx` | modify | Replace the hardcoded `STAGE_ID = 'china_utility.v1'` with a stage dropdown populated from `stages:list`. Persist last-picked stage in `localStorage`. |
| `src/renderer/components/ExtractionReview.tsx` | modify | Refactor field rendering into per-stage `<dl>` blocks. For `extraction.prompt_version === 'fuel_receipt.v1'` render the 9 new fields; for `'china_utility.v1'` keep the existing 6 fields. Stage chip shows the human description from `stages:list` instead of the raw id. Add a `buildFuelInitialValues` helper alongside the existing `buildInitialValues`. |
| `src/renderer/routes/documents_.$id.tsx` | modify | The `STAGE_ID` constant used by `RunExtractionAction` keeps its current value (`'china_utility.v1'`) as a fallback — but reading the spec carefully, we instead invoke run with the **stage id from the existing extraction row's `prompt_version`** if one was discarded, so the user retries with the right stage. (This unblocks "discarded fuel receipt → retry as fuel receipt".) |

---

## Task 1: `fuel-receipt.ts` schema + types

**Files:**
- Create: `src/main/llm/stages/fuel-receipt.ts`
- Test: `tests/main/llm/stages/fuel-receipt.test.ts`

This task lands the schema + an empty stage shell. Prompt content is added in Task 2; this task isolates the schema concerns from the prompt content so the test surface is clear.

- [ ] **Step 1: Write the failing schema tests**

Create `tests/main/llm/stages/fuel-receipt.test.ts` with these test groups:

```ts
import {
  type FuelReceiptExtraction,
  fuelReceiptExtraction,
  fuelReceiptStage,
} from '@main/llm/stages/fuel-receipt';
import { describe, expect, it } from 'vitest';

/**
 * Canonical happy-path extraction shape. Branch off this baseline and
 * tweak one field per test to assert acceptance / rejection.
 */
const GOOD: FuelReceiptExtraction = {
  doc_type: 'fuel_receipt',
  supplier_name: '中国石化北京加油站',
  fuel_type: '92#汽油',
  fuel_category: 'gasoline',
  volume_l: 38.5,
  unit_price_yuan: 7.85,
  amount_yuan: 302.23,
  occurred_at: '2026-04-15',
  license_plate: '京A12345',
  confidence: 'high',
};

describe('fuelReceiptExtraction schema', () => {
  it('accepts a fully populated fuel-receipt JSON', () => {
    expect(fuelReceiptExtraction.parse(GOOD)).toEqual(GOOD);
  });

  it('accepts the two nullable fields set to null (unit_price + license_plate)', () => {
    const parsed = fuelReceiptExtraction.parse({
      ...GOOD,
      unit_price_yuan: null,
      license_plate: null,
    });
    expect(parsed.unit_price_yuan).toBeNull();
    expect(parsed.license_plate).toBeNull();
  });

  it('accepts permissive zero values for volume_l and amount_yuan (model says "I cannot read this")', () => {
    // Same permissive-value contract as china_utility.v1. The review UI
    // flags zero numerics; ActivityForm validates at the activity_data
    // boundary.
    expect(() => fuelReceiptExtraction.parse({ ...GOOD, volume_l: 0 })).not.toThrow();
    expect(() => fuelReceiptExtraction.parse({ ...GOOD, amount_yuan: 0 })).not.toThrow();
  });

  it('accepts non-ISO / empty occurred_at strings (permissive)', () => {
    expect(() =>
      fuelReceiptExtraction.parse({ ...GOOD, occurred_at: '2026/04/15' }),
    ).not.toThrow();
    expect(() => fuelReceiptExtraction.parse({ ...GOOD, occurred_at: '' })).not.toThrow();
  });

  it('rejects negative volume_l (fueling can be zero but never negative)', () => {
    expect(() => fuelReceiptExtraction.parse({ ...GOOD, volume_l: -1 })).toThrow();
  });

  it('rejects negative amount_yuan', () => {
    expect(() => fuelReceiptExtraction.parse({ ...GOOD, amount_yuan: -1 })).toThrow();
  });

  it('rejects an unknown fuel_category value', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
      fuelReceiptExtraction.parse({ ...GOOD, fuel_category: 'rocket_fuel' } as any),
    ).toThrow();
  });

  it('accepts fuel_category = "other" (UI uses this as the fallback warning case)', () => {
    expect(() =>
      fuelReceiptExtraction.parse({ ...GOOD, fuel_category: 'other' }),
    ).not.toThrow();
  });

  it('rejects an unknown confidence value', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
      fuelReceiptExtraction.parse({ ...GOOD, confidence: 'maybe' } as any),
    ).toThrow();
  });

  it('rejects a doc_type other than the literal "fuel_receipt"', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
      fuelReceiptExtraction.parse({ ...GOOD, doc_type: 'china_utility' } as any),
    ).toThrow();
  });
});

describe('fuelReceiptStage metadata', () => {
  it('exposes id="fuel_receipt.v1", version, inputType, and prompt builders', () => {
    expect(fuelReceiptStage.id).toBe('fuel_receipt.v1');
    expect(fuelReceiptStage.version).toBe('1.0.0');
    expect(fuelReceiptStage.inputType).toBe('pdf_text');
    expect(typeof fuelReceiptStage.buildPrompt).toBe('function');
    expect(typeof fuelReceiptStage.buildVisionMessages).toBe('function');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/llm/stages/fuel-receipt.test.ts --pool=threads
```
Expected: FAIL with "Cannot find module '@main/llm/stages/fuel-receipt'".

- [ ] **Step 3: Create the schema-only module**

Create `src/main/llm/stages/fuel-receipt.ts` with the schema, type, and a stub stage. Prompt strings come in Task 2 — for now `buildPrompt` and `buildVisionMessages` return a minimal placeholder so the metadata test passes.

```ts
import { z } from 'zod';
import type { Stage, VisionMessages } from './types.js';

/**
 * Coarse fuel-category bucket driving downstream emission-factor lookup.
 * The 8 buckets cover every fuel type carbonbook needs to account for at
 * Phase 1 scope; "other" is the explicit fallback when the model can't
 * confidently classify (rare blends, non-fuel documents uploaded by
 * mistake). The review UI surfaces `fuel_category === 'other'` as a
 * warning chip + lets the user manually override before Confirm.
 *
 * Mapping intent (model gets this verbatim in the prompt):
 *   - all gasoline grades (92#/95#/98#/乙醇汽油)        → 'gasoline'
 *   - all diesel grades (0#/-10#/-35# 柴油)             → 'diesel'
 *   - 液化石油气 / LPG                                  → 'lpg'
 *   - 压缩天然气 / CNG / 天然气                          → 'cng'
 *   - 航空煤油 / jet fuel                                → 'jet_fuel'
 *   - 船用燃料油 / 船用柴油                              → 'marine_fuel'
 *   - B5 / B20 / 生物柴油                                → 'biofuel'
 *   - 不在以上列表 / 无法分类                            → 'other'
 */
export const fuelCategory = z.enum([
  'gasoline',
  'diesel',
  'lpg',
  'cng',
  'jet_fuel',
  'marine_fuel',
  'biofuel',
  'other',
]);
export type FuelCategory = z.infer<typeof fuelCategory>;

/**
 * Structured output schema for a Chinese fuel receipt (加油单据).
 *
 * Shape strict, values permissive — same contract as
 * `china_utility.v1`. The model is instructed to populate every field;
 * `unit_price_yuan` and `license_plate` are nullable because they're
 * commonly absent on real receipts (pre-paid receipts hide unit price;
 * walk-in customers may not have a plate). Numeric fields use `.min(0)`
 * so model can emit zero as an "I cannot read this" signal — the
 * review UI flags zero values; ActivityForm validates positive at the
 * activity_data boundary.
 *
 * The two-tier fuel typing is the only domain quirk vs china_utility:
 * `fuel_type` is the literal receipt text ("92#汽油"), `fuel_category`
 * is the 8-bucket classification (`'gasoline'`) that drives EF lookup
 * downstream. This separation preserves the original printed value
 * (audit trail, future regex-based EF refinement) while giving the
 * EF Matcher a coarse-but-reliable category to query.
 */
export const fuelReceiptExtraction = z.object({
  doc_type: z
    .literal('fuel_receipt')
    .describe('Always the literal "fuel_receipt".'),
  supplier_name: z
    .string()
    .describe(
      'Gas station / supplier name, e.g. "中国石化北京XX加油站", "中国石油". ' +
        'Empty string if not legible.',
    ),
  fuel_type: z
    .string()
    .describe(
      'Fuel label exactly as printed on the receipt: "92#汽油", "0#柴油", ' +
        '"LPG", etc. Empty string if not legible.',
    ),
  fuel_category: fuelCategory.describe(
    'Coarse bucket driving emission-factor lookup. ' +
      'Gasoline grades (92/95/98/乙醇) → gasoline; diesel grades (0/-10/-35) → diesel; ' +
      'liquefied petroleum gas (LPG/液化气) → lpg; compressed natural gas (CNG/天然气) → cng; ' +
      'aviation fuel → jet_fuel; marine/船用 → marine_fuel; B5/B20/生物柴油 → biofuel; ' +
      'unknown or non-fuel → other.',
  ),
  volume_l: z
    .number()
    .min(0)
    .describe(
      'Fuel volume in liters (升/L). 0 if not legible — UI will flag. ' +
        'If unit is m³ (CNG) or kg (some LPG), convert to liters with a ' +
        'reasonable density estimate AND set confidence=medium.',
    ),
  unit_price_yuan: z
    .number()
    .min(0)
    .nullable()
    .describe(
      'Per-liter price in CNY (元/升). null if not shown — some pre-paid ' +
        'receipts hide it.',
    ),
  amount_yuan: z
    .number()
    .min(0)
    .describe('Total amount paid in CNY (元). 0 if not legible — UI will flag.'),
  occurred_at: z
    .string()
    .describe(
      'Date of fueling as YYYY-MM-DD. Fueling is a single-point event ' +
        '(not a period); this is BOTH the start and end. Empty string ' +
        'if not legible.',
    ),
  license_plate: z
    .string()
    .nullable()
    .describe(
      'License plate of the fueled vehicle (车牌号), e.g. "京A12345". null ' +
        'if absent — walk-in customers and pre-paid receipts often omit it.',
    ),
  confidence: z
    .enum(['high', 'medium', 'low'])
    .describe(
      'high: supplier_name + fuel_category + volume_l + amount_yuan + occurred_at ' +
        'all clearly visible. medium: 1-2 of those inferred or partially obscured. ' +
        'low: this is not a fuel receipt, OR multiple required fields are guesses, ' +
        'OR fuel_category=other.',
    ),
});

export type FuelReceiptExtraction = z.infer<typeof fuelReceiptExtraction>;

/**
 * v1 Chinese-fuel-receipt stage. Mirrors `chinaUtilityStage` structure:
 * one schema, one text-path prompt, one vision-path prompt, both
 * sharing a private FIELD_RULES const so the model behaves identically
 * across the two input modes.
 *
 * Prompt body lands in Task 2 of the implementation plan; this stub
 * exists so the registry wiring + metadata tests can pass first.
 */
export const fuelReceiptStage: Stage<FuelReceiptExtraction> = {
  id: 'fuel_receipt.v1',
  version: '1.0.0',
  description: 'Chinese fuel receipt (加油单据) — classify + extract',
  inputType: 'pdf_text',
  schema: fuelReceiptExtraction,
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
pnpm vitest run tests/main/llm/stages/fuel-receipt.test.ts --pool=threads
```
Expected: PASS — 11 tests passing (10 schema tests + 1 stage-metadata test).

- [ ] **Step 5: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/main/llm/stages/fuel-receipt.ts tests/main/llm/stages/fuel-receipt.test.ts
git commit -m "feat(stages): fuel_receipt.v1 — schema + stage shell"
```

---

## Task 2: `fuel-receipt.ts` prompts (text + vision)

**Files:**
- Modify: `src/main/llm/stages/fuel-receipt.ts`
- Test: `tests/main/llm/stages/fuel-receipt.test.ts`

- [ ] **Step 1: Add prompt-content assertions to the metadata test**

Open `tests/main/llm/stages/fuel-receipt.test.ts`. Replace the existing single `it('exposes id="fuel_receipt.v1"...')` test inside `describe('fuelReceiptStage metadata', ...)` with the following three assertions:

```ts
describe('fuelReceiptStage metadata', () => {
  it('exposes id="fuel_receipt.v1", version, inputType, and prompt builders', () => {
    expect(fuelReceiptStage.id).toBe('fuel_receipt.v1');
    expect(fuelReceiptStage.version).toBe('1.0.0');
    expect(fuelReceiptStage.inputType).toBe('pdf_text');
    expect(typeof fuelReceiptStage.buildPrompt).toBe('function');
    expect(typeof fuelReceiptStage.buildVisionMessages).toBe('function');
  });

  it('buildPrompt embeds the PDF text inside <receipt>...</receipt> AND includes field rules', () => {
    const prompt = fuelReceiptStage.buildPrompt('SAMPLE_FUEL_RECEIPT_TEXT_TOKEN');
    expect(prompt).toContain('Chinese fuel receipt');
    expect(prompt).toContain('SAMPLE_FUEL_RECEIPT_TEXT_TOKEN');
    expect(prompt).toContain('<receipt>');
    expect(prompt).toContain('</receipt>');
    // Field rules verbatim shared with vision path.
    expect(prompt).toContain('fuel_category');
    expect(prompt).toContain('92#汽油');
    expect(prompt).toContain('gasoline');
  });

  it('buildVisionMessages mirrors buildPrompt field rules but omits the <receipt> placeholder', () => {
    const msgs = fuelReceiptStage.buildVisionMessages?.();
    expect(msgs).toBeDefined();
    expect(msgs?.userText).toContain('Chinese fuel receipt');
    expect(msgs?.userText).toContain('fuel_category');
    expect(msgs?.userText).toContain('92#汽油');
    expect(msgs?.userText).toContain('gasoline');
    // No PDF text placeholder — image content is appended by the caller.
    expect(msgs?.userText).not.toContain('<receipt>');
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/llm/stages/fuel-receipt.test.ts --pool=threads
```
Expected: 11 schema tests still pass; 2 of the 3 metadata tests fail (the prompt-content assertions). The `id/version/inputType` test still passes.

- [ ] **Step 3: Replace the stub prompts with the real ones**

In `src/main/llm/stages/fuel-receipt.ts`, replace the entire `fuelReceiptStage` export at the bottom of the file (everything from the JSDoc comment above it onward) with:

```ts
/**
 * Field-mapping + output-format rules shared between `buildPrompt`
 * (text path) and `buildVisionMessages` (image path). Extracting this
 * to a const guarantees the two paths stay aligned — diverging copies
 * would cause the model to behave differently for the same receipt
 * depending on which path triggered. Same DRY pattern as
 * china_utility.v1.
 */
const FIELD_RULES = `Output rules (CRITICAL — DeepSeek and other providers without native JSON
schema mode read these directly):
- Return EXACTLY ONE JSON object, no markdown, no \`\`\`json fences, no prose.
- Every required field must be present. Numeric fields are numbers (not
  strings). Date fields are strings in ISO format "YYYY-MM-DD".
- If a value is genuinely missing on the receipt, use null ONLY for the
  two fields explicitly marked nullable (unit_price_yuan, license_plate).
  Never omit a key. Never use null for required fields — emit a
  best-guess instead with confidence='low'.

Field mapping (Chinese receipts follow regional variations):
- doc_type: always "fuel_receipt".
- supplier_name: the issuing gas station / supplier, e.g.
  "中国石化北京XX加油站", "中国石油第N加油站", or just "中国石化".
- fuel_type: the fuel label EXACTLY as printed on the receipt
  ("92#汽油", "95#汽油", "0#柴油", "-10#柴油", "LPG", "天然气", etc.).
  Empty string if not legible.
- fuel_category: coarse 8-bucket classification driving EF lookup.
  - gasoline:    92#/95#/98#/乙醇汽油/任何带 "汽油" 字样
  - diesel:      0#/-10#/-35#/任何带 "柴油" 字样
  - lpg:         "液化石油气" / "LPG" / "液化气"
  - cng:         "压缩天然气" / "CNG" / "天然气" (vehicle-fueling context)
  - jet_fuel:    "航空煤油" / "Jet A-1" / aviation
  - marine_fuel: "船用燃料油" / "船用柴油" / marine
  - biofuel:     "B5" / "B20" / "生物柴油" / biodiesel
  - other:       anything you can't confidently bucket above; also set
                 confidence='low' when you choose this.
- volume_l: numeric liters.
  - "升" / "L" / "公升" → liters directly.
  - "m³" (CNG by volume) → convert with density (CNG ~0.74 kg/m³ → no
    direct liter equivalent; report the m³ value AS IF it were liters
    and set confidence='medium' with the warning that volume_l is
    actually m³).
  - "kg" (LPG sometimes) → divide by ~0.54 kg/L (LPG density) and set
    confidence='medium'.
- unit_price_yuan: numeric CNY per liter ("单价" / "元/升"). null if not
  shown.
- amount_yuan: total CNY paid ("金额" / "实付" / "合计"). Number only
  (no "¥" / "元"). 0 if not legible.
- occurred_at: date as ISO YYYY-MM-DD. If only year-month shown
  ("2026-04"), assume the 15th. Fueling is a single-point event — set
  this to the receipt's printed date.
- license_plate: Chinese plate format ("京A12345", "粤B·12345", etc.).
  null if absent.
- confidence:
  - "high" if supplier_name, fuel_category, volume_l, amount_yuan, and
    occurred_at are all clearly visible and unambiguous.
  - "medium" if one was inferred OR a unit conversion was applied
    (m³ → L, kg → L).
  - "low" if the document doesn't look like a fuel receipt at all, OR
    fuel_category=other, OR multiple required fields are guesses.

Ignore (DO NOT include in the output): mileage, vehicle make, VIN,
fapiao receipt number, payment method (cash/card/QR), cashier id,
membership points.

Example valid response shape (do not copy values — extract from the
real receipt):
{"doc_type":"fuel_receipt","supplier_name":"中国石化北京加油站","fuel_type":"92#汽油","fuel_category":"gasoline","volume_l":38.5,"unit_price_yuan":7.85,"amount_yuan":302.23,"occurred_at":"2026-04-15","license_plate":"京A12345","confidence":"high"}`;

/**
 * v1 Chinese-fuel-receipt stage. Mirrors `chinaUtilityStage`:
 * - same Stage<T> shape;
 * - text path uses <receipt>${pdfText}</receipt> wrapper analogous to
 *   china_utility's <bill> wrapper;
 * - vision path swaps the wrapper for an "images attached" hint and
 *   reuses FIELD_RULES verbatim;
 * - prompt is in English (instruction-following) while the receipt
 *   content stays Chinese.
 */
export const fuelReceiptStage: Stage<FuelReceiptExtraction> = {
  id: 'fuel_receipt.v1',
  version: '1.0.0',
  description: 'Chinese fuel receipt (加油单据) — classify + extract',
  inputType: 'pdf_text',
  schema: fuelReceiptExtraction,
  buildPrompt: (pdfText: string) => `
You are extracting structured data from a Chinese fuel receipt (加油单据).

Receipt text (extracted from PDF):
<receipt>
${pdfText}
</receipt>

${FIELD_RULES}`,
  buildVisionMessages: (): VisionMessages => ({
    userText: `You are extracting structured data from a Chinese fuel receipt (加油单据).

The receipt is provided as one or more PNG images (one per PDF page) attached to this
message. Look at the images directly — do NOT request OCR text from another tool.

If the PDF shows multiple receipts batched together (gas stations sometimes do this),
extract the most prominent / largest one and set confidence='low'.

${FIELD_RULES}`,
  }),
};
```

- [ ] **Step 4: Run all tests to confirm green**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/llm/stages/fuel-receipt.test.ts --pool=threads
```
Expected: 13 tests passing (10 schema + 3 metadata).

Also re-run the typecheck to confirm no regression elsewhere:
```bash
pnpm typecheck
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/main/llm/stages/fuel-receipt.ts tests/main/llm/stages/fuel-receipt.test.ts
git commit -m "feat(stages): fuel_receipt.v1 — text + vision prompts with shared FIELD_RULES"
```

---

## Task 3: Register `fuelReceiptStage`

**Files:**
- Modify: `src/main/llm/stages/registry.ts`
- Test: existing `tests/main/llm/stages/fuel-receipt.test.ts` is enough — adding a registry-level test would duplicate the assertion.

The change is one line, but consequential: it makes the new stage discoverable to `ExtractionService.run({ stage_id: 'fuel_receipt.v1' })` and to the `stages:list` IPC handler that the UI dropdown will consume.

- [ ] **Step 1: Add a registration test**

Open `tests/main/llm/stages/fuel-receipt.test.ts` and append the following describe block at the end of the file:

```ts
import { getStage, listStages } from '@main/llm/stages/registry';

describe('fuelReceiptStage registry integration', () => {
  it('is returned by getStage("fuel_receipt.v1")', () => {
    expect(getStage('fuel_receipt.v1')).toBe(fuelReceiptStage);
  });

  it('appears in listStages()', () => {
    const ids = listStages().map((s) => s.id);
    expect(ids).toContain('fuel_receipt.v1');
    // china_utility.v1 still registered too — adding a stage shouldn't
    // displace existing ones.
    expect(ids).toContain('china_utility.v1');
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/llm/stages/fuel-receipt.test.ts --pool=threads
```
Expected: 13 prior tests still pass; 2 new tests fail (`getStage` returns undefined, `listStages` doesn't include `fuel_receipt.v1`).

- [ ] **Step 3: Add the registry entry**

Open `src/main/llm/stages/registry.ts`. Replace the existing imports + Map literal:
```ts
import { chinaUtilityStage } from './china-utility.js';
import type { Stage } from './types.js';

const _stageRegistry = new Map<string, Stage>([[chinaUtilityStage.id, chinaUtilityStage as Stage]]);
```

with:
```ts
import { chinaUtilityStage } from './china-utility.js';
import { fuelReceiptStage } from './fuel-receipt.js';
import type { Stage } from './types.js';

const _stageRegistry = new Map<string, Stage>([
  [chinaUtilityStage.id, chinaUtilityStage as Stage],
  [fuelReceiptStage.id, fuelReceiptStage as Stage],
]);
```

Leave the rest of the file unchanged (`stageRegistry`, `getStage`, `listStages`, `registerStage`).

- [ ] **Step 4: Run all tests to confirm green**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads
```
Expected: 312 tests passing (310 from phase-1c + 2 new from the registry tests; the prior 13 fuel-receipt tests continue to pass).

- [ ] **Step 5: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/main/llm/stages/registry.ts tests/main/llm/stages/fuel-receipt.test.ts
git commit -m "feat(stages): register fuel_receipt.v1 in stage registry"
```

---

## Task 4: i18n strings

**Files:**
- Modify: `messages/en.json`
- Modify: `messages/zh-CN.json`

Add the field labels + stage-picker hint that the upcoming UI tasks (5, 6) will consume. Landing them now keeps the UI tasks free of i18n noise.

- [ ] **Step 1: Validate current JSON is well-formed before edits**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
node -e "JSON.parse(require('fs').readFileSync('messages/en.json', 'utf8')); JSON.parse(require('fs').readFileSync('messages/zh-CN.json', 'utf8')); console.log('OK');"
```
Expected: `OK`.

- [ ] **Step 2: Add new keys to en.json**

Open `messages/en.json`. Find the existing line `"documents_review_field_period_end": "Period end",` and INSERT the following 8 keys immediately after it (before the next non-`documents_review_field_*` key):

```json
  "documents_review_field_fuel_type": "Fuel type (as printed)",
  "documents_review_field_fuel_category": "Fuel category",
  "documents_review_field_volume_l": "Volume (L)",
  "documents_review_field_unit_price_yuan": "Unit price (CNY/L)",
  "documents_review_field_occurred_at": "Fueling date",
  "documents_review_field_license_plate": "License plate",
  "documents_review_fuel_category_other_warning": "Fuel category couldn't be classified — please override manually before Confirm.",
  "documents_upload_pick_stage": "Document type",
```

- [ ] **Step 3: Add new keys to zh-CN.json**

Open `messages/zh-CN.json`. Find the existing line `"documents_review_field_period_end": "计费终止",` and INSERT the following 8 keys immediately after it:

```json
  "documents_review_field_fuel_type": "燃料品种（票面）",
  "documents_review_field_fuel_category": "燃料大类",
  "documents_review_field_volume_l": "加油量（L）",
  "documents_review_field_unit_price_yuan": "单价（元/L）",
  "documents_review_field_occurred_at": "加油日期",
  "documents_review_field_license_plate": "车牌号",
  "documents_review_fuel_category_other_warning": "无法自动分类燃料大类——请在确认前手动调整。",
  "documents_upload_pick_stage": "单据类型",
```

- [ ] **Step 4: Validate JSON + force paraglide regen**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
node -e "JSON.parse(require('fs').readFileSync('messages/en.json', 'utf8')); JSON.parse(require('fs').readFileSync('messages/zh-CN.json', 'utf8')); console.log('OK');"
pnpm exec paraglide-js compile --project ./project.inlang --outdir ./src/renderer/paraglide
pnpm typecheck
```
Expected: `OK`, then paraglide regenerates without warnings, then typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add messages/en.json messages/zh-CN.json src/renderer/paraglide
git commit -m "feat(i18n): fuel-receipt field labels + stage-picker UX strings"
```

---

## Task 5: Stage picker on the upload zone

**Files:**
- Modify: `src/renderer/components/DocumentsUpload.tsx`

Currently the upload zone has a hardcoded `const STAGE_ID = 'china_utility.v1';`. Replace with a `<select>` populated from `stages:list` (already a wired IPC), persist the last pick in `localStorage`, and feed it to `extractionApi.run`.

- [ ] **Step 1: Read the existing DocumentsUpload.tsx so the changes are precise**

The current top of the file (imports + state) looks roughly like:
```tsx
import { toast } from '@renderer/components/toast';
import { documentApi } from '@renderer/lib/api/document';
import { extractionApi } from '@renderer/lib/api/extraction';
import { subscribe } from '@renderer/lib/ipc';
import * as m from '@renderer/paraglide/messages';
import { useQueryClient } from '@tanstack/react-query';
import { UploadCloud } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

// ...
type UploadState = 'idle' | 'uploading' | 'extracting' | 'done';

const ACCEPT = 'application/pdf';
const STAGE_ID = 'china_utility.v1';
```

We're going to:
1. Replace the hardcoded `STAGE_ID` constant with state read from `localStorage`.
2. Pull the stage list via `stagesApi.list()` (a renderer wrapper around `stages:list` IPC).
3. Render a `<select>` next to the upload zone (visually outside the drop-zone label so click-through doesn't fight us).
4. Pass the picked stage id into `extractionApi.run`.

- [ ] **Step 2: Replace the file contents**

Open `src/renderer/components/DocumentsUpload.tsx` and replace its entire contents with:

```tsx
import { toast } from '@renderer/components/toast';
import { documentApi } from '@renderer/lib/api/document';
import { extractionApi } from '@renderer/lib/api/extraction';
import { stagesApi } from '@renderer/lib/api/stages';
import { subscribe } from '@renderer/lib/ipc';
import * as m from '@renderer/paraglide/messages';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UploadCloud } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/**
 * Phase 1b — drag-drop upload zone for source PDFs.
 *
 * Two-step pipeline per drop:
 *   1. `document:upload` — write file, dedupe by sha256, return a Document row.
 *   2. `extraction:run` (stage chosen by the user from the dropdown) →
 *      LLM round-trip → `extraction` row with `status='review_needed'`.
 *
 * Phase 1c — when the PDF has no text layer, `extraction:run` falls back
 * to the vision path on the main side and sends an `extraction:progress`
 * event with `{ phase: 'vision' }`. This component subscribes for the
 * current document id and flips the spinner copy from "Extracting…" to
 * "Recognizing image (longer wait)…".
 *
 * Phase 1d — added a stage dropdown so non-electricity documents (fuel
 * receipts now; freight / purchase / travel coming) can run their own
 * extraction stage. Default and last-picked persists in localStorage
 * key `carbonbook.upload.last-stage` so heavy users don't re-pick on
 * every drop.
 *
 * Status state machine for the visual progress label:
 *   idle → uploading → extracting (→ extracting:vision on progress event) → done → idle
 *
 * Disabled state covers all non-idle states. The progress subscription
 * is scoped to the active upload's document id so a stale "switched
 * to vision" event from a previous file doesn't sneak into the next
 * one.
 */
type UploadState = 'idle' | 'uploading' | 'extracting' | 'done';

const ACCEPT = 'application/pdf';
const DEFAULT_STAGE_ID = 'china_utility.v1';
const LAST_STAGE_LS_KEY = 'carbonbook.upload.last-stage';

function readLastStageId(): string {
  try {
    return localStorage.getItem(LAST_STAGE_LS_KEY) || DEFAULT_STAGE_ID;
  } catch {
    // localStorage can throw in restricted contexts (incognito + 3p
    // origin embedding etc.); we don't want the upload UI to die from
    // a quota or access error. Fall back to the default stage id.
    return DEFAULT_STAGE_ID;
  }
}

function writeLastStageId(id: string): void {
  try {
    localStorage.setItem(LAST_STAGE_LS_KEY, id);
  } catch {
    // Best-effort persistence; not blocking the upload.
  }
}

export function DocumentsUpload() {
  const [state, setState] = useState<UploadState>('idle');
  const [visionPhase, setVisionPhase] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [stageId, setStageId] = useState<string>(() => readLastStageId());
  const inputRef = useRef<HTMLInputElement | null>(null);
  const queryClient = useQueryClient();

  // Stages don't change at runtime in production (registry is a static
  // Map; mutations happen at app startup before the renderer renders).
  // staleTime: Infinity avoids any refetch noise.
  const stagesQuery = useQuery({
    queryKey: ['stages:list'],
    queryFn: stagesApi.list,
    staleTime: Infinity,
  });
  const stages = stagesQuery.data ?? [];

  useEffect(() => {
    if (!activeDocId) return;
    const unsubscribe = subscribe('extraction:progress', (payload) => {
      if (payload.document_id === activeDocId && payload.phase === 'vision') {
        setVisionPhase(true);
      }
    });
    return unsubscribe;
  }, [activeDocId]);

  async function handleFile(file: File): Promise<void> {
    if (state !== 'idle') return;
    if (file.type !== ACCEPT) {
      toast.error(m.documents_upload_failed(), {
        description: m.documents_upload_pdf_only(),
      });
      return;
    }

    setState('uploading');
    setVisionPhase(false);
    let doc: Awaited<ReturnType<typeof documentApi.upload>>;
    try {
      const buffer = await file.arrayBuffer();
      doc = await documentApi.upload({
        filename: file.name,
        mimeType: file.type,
        bytes: new Uint8Array(buffer),
      });
      toast.success(m.documents_upload_success(), { description: file.name });
      await queryClient.invalidateQueries({ queryKey: ['document:list'] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(m.documents_upload_failed(), { description: msg });
      setState('idle');
      return;
    }

    setActiveDocId(doc.id);
    setState('extracting');
    try {
      await extractionApi.run({ document_id: doc.id, stage_id: stageId });
      toast.success(m.documents_extraction_done(), { description: file.name });
      await queryClient.invalidateQueries({ queryKey: ['document:list'] });
      await queryClient.invalidateQueries({
        queryKey: ['extraction:list-by-document', doc.id],
      });
      await queryClient.invalidateQueries({ queryKey: ['extraction:list-pending'] });
      await queryClient.invalidateQueries({ queryKey: ['extraction:list-statuses'] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(m.documents_extraction_failed(), { description: msg });
    } finally {
      setState('done');
      setTimeout(() => {
        setState('idle');
        setActiveDocId(null);
        setVisionPhase(false);
      }, 1200);
    }
  }

  function onDrop(e: React.DragEvent<HTMLLabelElement>): void {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = '';
  }

  function onStageChange(e: React.ChangeEvent<HTMLSelectElement>): void {
    const next = e.target.value;
    setStageId(next);
    writeLastStageId(next);
  }

  const disabled = state !== 'idle';
  const label =
    state === 'uploading'
      ? m.documents_uploading()
      : state === 'extracting'
        ? visionPhase
          ? m.documents_extracting_vision()
          : m.documents_extracting()
        : state === 'done'
          ? m.documents_upload_done()
          : m.documents_upload_hint();

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <label htmlFor="documents-upload-stage" className="text-muted-foreground">
          {m.documents_upload_pick_stage()}:
        </label>
        <select
          id="documents-upload-stage"
          value={stageId}
          onChange={onStageChange}
          disabled={disabled}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm"
        >
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.description}
            </option>
          ))}
        </select>
      </div>

      <label
        htmlFor="documents-upload-input"
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        data-state={state}
        data-dragging={isDragging || undefined}
        className={[
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border bg-muted/30 px-6 py-10 text-sm transition-colors',
          'hover:border-primary/60 hover:bg-muted/50',
          'data-[dragging]:border-primary data-[dragging]:bg-primary/5',
          disabled ? 'pointer-events-none opacity-60' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <UploadCloud className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">{m.documents_upload_pdf_only()}</span>
        <input
          ref={inputRef}
          id="documents-upload-input"
          type="file"
          accept={ACCEPT}
          className="sr-only"
          disabled={disabled}
          onChange={onFileChange}
        />
      </label>
    </div>
  );
}
```

- [ ] **Step 3: Verify typecheck + lint + tests**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run --pool=threads 2>&1 | tail -5
pnpm lint --max-diagnostics=80 2>&1 | grep "DocumentsUpload" | head
```
Expected:
- typecheck: clean
- vitest: 312 tests still passing (no test added/removed in this task; existing /documents tests use DocumentsUpload and need to keep passing)
- lint: no new errors on DocumentsUpload.tsx

If the existing `tests/renderer/documents.test.tsx` test breaks because it stubs `extraction:run` or hard-codes `STAGE_ID`, update that test to ALSO stub the new `stages:list` IPC call. Look at the test to confirm. (If the test passes as-is, no change needed.)

- [ ] **Step 4: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/renderer/components/DocumentsUpload.tsx
# Include tests/renderer/documents.test.tsx in the commit too if Step 3 forced an update.
git diff --cached --name-only   # sanity check before committing
git commit -m "feat(ui): DocumentsUpload — stage dropdown driven by stages:list IPC, last-pick persisted"
```

---

## Task 6: `ExtractionReview` renders per-stage field sets

**Files:**
- Modify: `src/renderer/components/ExtractionReview.tsx`

The current component hardcodes the 6 china_utility fields and a single `buildInitialValues` helper. Refactor so:
1. The field rendering switches on `extraction.prompt_version`.
2. The ActivityForm `initialValues` builder also switches on `prompt_version`.
3. The stage chip displays the stage's human description (from `stages:list`) instead of the raw id.
4. A `fuel_category === 'other'` extraction shows an inline warning chip in the review pane.

- [ ] **Step 1: Read the current ExtractionReview shape**

(The full current file is in `src/renderer/components/ExtractionReview.tsx`. Key bits this task touches: imports at the top, the `ChinaUtilityParsed` type, the `<dl>` field grid around lines 203-216, the ActivityForm `initialValues` prop at the bottom, and the `buildInitialValues` helper at the very end.)

- [ ] **Step 2: Replace the whole file**

Replace the entire contents of `src/renderer/components/ExtractionReview.tsx` with:

```tsx
import { ActivityForm } from '@renderer/components/ActivityForm';
import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { sourceApi } from '@renderer/lib/api/emission-source';
import { extractionApi } from '@renderer/lib/api/extraction';
import { orgApi } from '@renderer/lib/api/organization';
import { stagesApi } from '@renderer/lib/api/stages';
import * as m from '@renderer/paraglide/messages';
import type { Document, EmissionSource, Extraction } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

/**
 * Right pane of the document review page — renders the AI-extracted fields
 * for a single `Extraction`, plus Confirm/Discard actions.
 *
 * Phase 1d introduced per-stage field rendering. The component switches on
 * `extraction.prompt_version` to pick:
 *   - which parser interprets `parsed_json`
 *   - which `<Field>` rows to render
 *   - which `buildXxxInitialValues` produces the ActivityForm prefill
 *
 * Adding a 3rd stage (freight/purchase/travel) means: add a parser, add a
 * Field-block renderer, add an initial-values builder, add a switch arm.
 * When this file grows past ~400 LOC, refactor per-stage parts to their
 * own files under `src/renderer/components/extractions/<stage>/`. For now
 * 2 stages share this file because the surface is still small.
 *
 * Confirm flow:
 *   1. User picks emission_source + EF in the embedded ActivityForm.
 *   2. ActivityForm submits → `activityApi.create` returns the new row.
 *   3. `onSubmitSuccess` fires `extractionApi.confirm({ id })` to flip the
 *      extraction to `parsed` status.
 *   4. Navigate to / (dashboard) so the user sees their emission total tick
 *      up immediately.
 *
 * Discard flow:
 *   `extractionApi.discard({ id })` flips status → 'rejected', clears
 *   parsed_json. Navigate back to /documents.
 */
export interface ExtractionReviewProps {
  extraction: Extraction;
  document: Document;
}

// ---------------------------------------------------------------------------
// Per-stage parsed types + parsers
// ---------------------------------------------------------------------------

type ChinaUtilityParsed = {
  doc_type?: string;
  supplier_name?: string;
  account_no?: string | null;
  amount_kwh?: number;
  amount_yuan?: number | null;
  period_start?: string;
  period_end?: string;
  confidence?: 'high' | 'medium' | 'low';
};

type FuelReceiptParsed = {
  doc_type?: string;
  supplier_name?: string;
  fuel_type?: string;
  fuel_category?:
    | 'gasoline'
    | 'diesel'
    | 'lpg'
    | 'cng'
    | 'jet_fuel'
    | 'marine_fuel'
    | 'biofuel'
    | 'other';
  volume_l?: number;
  unit_price_yuan?: number | null;
  amount_yuan?: number;
  occurred_at?: string;
  license_plate?: string | null;
  confidence?: 'high' | 'medium' | 'low';
};

type StageParsed =
  | { stage: 'china_utility.v1'; data: ChinaUtilityParsed }
  | { stage: 'fuel_receipt.v1'; data: FuelReceiptParsed };

function parseExtraction(
  raw: string | null,
  promptVersion: string,
): StageParsed | null {
  if (!raw) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  // The discriminator is the persisted prompt_version, not anything
  // inside parsed_json itself. A malformed extraction (raw text that
  // claims doc_type X but came from stage Y) is still rendered per the
  // stage; the field-block renderer surfaces empty / unexpected values.
  if (promptVersion === 'china_utility.v1') {
    return { stage: 'china_utility.v1', data: obj as ChinaUtilityParsed };
  }
  if (promptVersion === 'fuel_receipt.v1') {
    return { stage: 'fuel_receipt.v1', data: obj as FuelReceiptParsed };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Confidence chip mapping
// ---------------------------------------------------------------------------

const CONFIDENCE_CLASSES: Record<'high' | 'medium' | 'low', string> = {
  high: 'border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary)]/10 text-[color:var(--color-primary)]',
  medium: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  low: 'border-destructive/40 bg-destructive/10 text-destructive',
};

const CONFIDENCE_LABELS: Record<'high' | 'medium' | 'low', () => string> = {
  high: m.documents_review_confidence_high,
  medium: m.documents_review_confidence_medium,
  low: m.documents_review_confidence_low,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExtractionReview({ extraction, document }: ExtractionReviewProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const parsed = useMemo(
    () => parseExtraction(extraction.parsed_json, extraction.prompt_version),
    [extraction.parsed_json, extraction.prompt_version],
  );

  // Stage description for the chip — falls back to the raw id if the
  // stages:list query hasn't resolved yet or the stage isn't registered.
  const stagesQuery = useQuery({
    queryKey: ['stages:list'],
    queryFn: stagesApi.list,
    staleTime: Infinity,
  });
  const stageDescription =
    stagesQuery.data?.find((s) => s.id === extraction.prompt_version)?.description ??
    extraction.prompt_version;

  const orgQuery = useQuery({
    queryKey: ['org:get-current'],
    queryFn: orgApi.getCurrent,
  });
  const orgId = orgQuery.data?.id;

  const sourcesQuery = useQuery<EmissionSource[]>({
    queryKey: ['source:list-by-org', orgId],
    queryFn: () => sourceApi.listByOrg({ organization_id: orgId ?? '' }),
    enabled: !!orgId,
  });

  const discardMutation = useMutation({
    mutationFn: () => extractionApi.discard({ id: extraction.id }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['extraction:list-by-document', document.id],
      });
      await queryClient.invalidateQueries({ queryKey: ['extraction:list-pending'] });
      await queryClient.invalidateQueries({ queryKey: ['extraction:list-statuses'] });
      toast.success(m.documents_review_discard_success());
      navigate({ to: '/documents' });
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(m.documents_review_discard_failed(), { description: msg });
    },
  });

  const requestDiscard = () => {
    if (window.confirm(m.documents_review_discard_confirm())) {
      discardMutation.mutate();
    }
  };

  const handleSubmitSuccess = async () => {
    try {
      await extractionApi.confirm({ id: extraction.id });
      toast.success(m.documents_review_confirm_success());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(m.documents_review_confirm_failed(), { description: msg });
    }
    await queryClient.invalidateQueries({
      queryKey: ['extraction:list-by-document', document.id],
    });
    await queryClient.invalidateQueries({ queryKey: ['extraction:list-pending'] });
    await queryClient.invalidateQueries({ queryKey: ['extraction:list-statuses'] });
    navigate({ to: '/' });
  };

  if (!parsed) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        {m.documents_review_parse_error()}
        <div className="mt-3">
          <Button
            type="button"
            variant="outline"
            onClick={requestDiscard}
            disabled={discardMutation.isPending}
          >
            {m.documents_review_discard()}
          </Button>
        </div>
      </div>
    );
  }

  const confidence = parsed.data.confidence ?? 'medium';
  const confidenceClass = CONFIDENCE_CLASSES[confidence];
  const confidenceLabel = CONFIDENCE_LABELS[confidence]();

  // fuel-only warning: the model selected "other" because it couldn't
  // confidently bucket the fuel. The user MUST override before this
  // gets to ActivityForm because the EF lookup needs a known category.
  const showFuelOtherWarning =
    parsed.stage === 'fuel_receipt.v1' && parsed.data.fuel_category === 'other';

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-muted/30 p-4 text-sm">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span
            className="rounded border border-border bg-background px-2 py-0.5"
            title={extraction.prompt_version}
          >
            {m.documents_review_stage()}: {stageDescription}
          </span>
          <span className="rounded border border-border bg-background px-2 py-0.5">
            {m.documents_review_provider()}: {extraction.llm_provider} · {extraction.llm_model}
          </span>
          <span
            className={`rounded border px-2 py-0.5 font-medium ${confidenceClass}`}
            title={`${m.documents_review_confidence()}: ${confidenceLabel}`}
          >
            {m.documents_review_confidence()}: {confidenceLabel}
          </span>
        </div>

        {parsed.stage === 'china_utility.v1' ? (
          <ChinaUtilityFields data={parsed.data} />
        ) : (
          <FuelReceiptFields data={parsed.data} />
        )}

        {showFuelOtherWarning && (
          <div className="mt-3 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {m.documents_review_fuel_category_other_warning()}
          </div>
        )}
      </div>

      {extraction.status === 'parsed' ? (
        <div className="rounded-md border border-border bg-muted/30 p-4 text-sm">
          <p className="font-medium">{m.documents_review_already_confirmed_title()}</p>
          <p className="mt-1 text-muted-foreground">
            {m.documents_review_already_confirmed_body()}
          </p>
          <Link
            to="/activities"
            className="mt-3 inline-block text-sm text-[color:var(--color-primary)] hover:underline"
          >
            {m.documents_review_view_activities_link()}
          </Link>
        </div>
      ) : !showForm ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => setShowForm(true)}>
            {m.documents_review_confirm()}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={requestDiscard}
            disabled={discardMutation.isPending}
          >
            {m.documents_review_discard()}
          </Button>
        </div>
      ) : orgQuery.isLoading || sourcesQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">{m.loading()}</p>
      ) : !orgId ? (
        <p className="text-sm text-destructive">{m.documents_review_load_failed()}</p>
      ) : (
        <ActivityForm
          organizationId={orgId}
          sources={sourcesQuery.data ?? []}
          onCancel={() => setShowForm(false)}
          onSubmitSuccess={() => {
            void handleSubmitSuccess();
          }}
          initialValues={
            parsed.stage === 'china_utility.v1'
              ? buildChinaUtilityInitialValues(parsed.data, document.filename)
              : buildFuelReceiptInitialValues(parsed.data, document.filename)
          }
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-stage <dl> field blocks
// ---------------------------------------------------------------------------

function ChinaUtilityFields({ data }: { data: ChinaUtilityParsed }) {
  return (
    <dl className="grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-4">
      <Field label={m.documents_review_field_supplier()} value={data.supplier_name} />
      <Field label={m.documents_review_field_account()} value={data.account_no} />
      <Field
        label={m.documents_review_field_amount_kwh()}
        value={typeof data.amount_kwh === 'number' ? `${data.amount_kwh} kWh` : undefined}
      />
      <Field
        label={m.documents_review_field_amount_yuan()}
        value={typeof data.amount_yuan === 'number' ? `¥${data.amount_yuan}` : undefined}
      />
      <Field label={m.documents_review_field_period_start()} value={data.period_start} />
      <Field label={m.documents_review_field_period_end()} value={data.period_end} />
    </dl>
  );
}

function FuelReceiptFields({ data }: { data: FuelReceiptParsed }) {
  return (
    <dl className="grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-4">
      <Field label={m.documents_review_field_supplier()} value={data.supplier_name} />
      <Field label={m.documents_review_field_fuel_type()} value={data.fuel_type} />
      <Field label={m.documents_review_field_fuel_category()} value={data.fuel_category} />
      <Field
        label={m.documents_review_field_volume_l()}
        value={typeof data.volume_l === 'number' ? `${data.volume_l} L` : undefined}
      />
      <Field
        label={m.documents_review_field_unit_price_yuan()}
        value={typeof data.unit_price_yuan === 'number' ? `¥${data.unit_price_yuan}` : undefined}
      />
      <Field
        label={m.documents_review_field_amount_yuan()}
        value={typeof data.amount_yuan === 'number' ? `¥${data.amount_yuan}` : undefined}
      />
      <Field label={m.documents_review_field_occurred_at()} value={data.occurred_at} />
      <Field label={m.documents_review_field_license_plate()} value={data.license_plate} />
    </dl>
  );
}

// ---------------------------------------------------------------------------
// ActivityForm prefill builders (per stage)
// ---------------------------------------------------------------------------

/**
 * China utility prefill: amount in kWh, period range, supplier in notes.
 * Same shape Phase 1b shipped.
 */
function buildChinaUtilityInitialValues(
  data: ChinaUtilityParsed,
  filename: string,
): import('@renderer/components/ActivityForm').ActivityFormInitialValues {
  const out: import('@renderer/components/ActivityForm').ActivityFormInitialValues = {
    unit: 'kWh',
    notes: `Auto-extracted from: ${filename}`,
  };
  if (data.period_start) out.occurred_at_start = data.period_start;
  if (data.period_end) out.occurred_at_end = data.period_end;
  if (typeof data.amount_kwh === 'number') out.amount = String(data.amount_kwh);
  return out;
}

/**
 * Fuel receipt prefill: amount in liters, single-day event (start =
 * end), supplier + plate in notes. Fueling has no period — both date
 * bounds collapse to `occurred_at`.
 */
function buildFuelReceiptInitialValues(
  data: FuelReceiptParsed,
  filename: string,
): import('@renderer/components/ActivityForm').ActivityFormInitialValues {
  const notesParts = [`Auto-extracted from: ${filename}`];
  if (data.supplier_name) notesParts.push(`Supplier: ${data.supplier_name}`);
  if (data.license_plate) notesParts.push(`Plate: ${data.license_plate}`);
  if (data.fuel_type) notesParts.push(`Fuel: ${data.fuel_type}`);
  const out: import('@renderer/components/ActivityForm').ActivityFormInitialValues = {
    unit: 'L',
    notes: notesParts.join(' · '),
  };
  if (data.occurred_at) {
    out.occurred_at_start = data.occurred_at;
    out.occurred_at_end = data.occurred_at;
  }
  if (typeof data.volume_l === 'number') out.amount = String(data.volume_l);
  return out;
}

// ---------------------------------------------------------------------------
// Generic field row
// ---------------------------------------------------------------------------

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  const display = value === null || value === undefined || value === '' ? '—' : String(value);
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{display}</dd>
    </>
  );
}
```

- [ ] **Step 3: Verify typecheck + lint + tests**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run --pool=threads 2>&1 | tail -5
pnpm lint --max-diagnostics=80 2>&1 | grep "ExtractionReview" | head
```
Expected:
- typecheck: clean
- vitest: 312 tests passing (the existing ExtractionReview render path for china_utility.v1 is preserved)
- lint: no new errors

- [ ] **Step 4: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/renderer/components/ExtractionReview.tsx
git commit -m "feat(ui): ExtractionReview — per-stage field renderers + ActivityForm prefill"
```

---

## Task 7: Document detail page retry-after-discard uses the original stage id

**Files:**
- Modify: `src/renderer/routes/documents_.$id.tsx`

Currently `RunExtractionAction` hardcodes `const STAGE_ID = 'china_utility.v1'`. After Task 5/6 a user can upload a fuel receipt and discard it, then come back to retry — but the retry button would silently re-run as china_utility.v1, which fails because the fuel receipt PDF won't match that stage's schema. The fix: when a discarded extraction exists for the doc, retry with THAT stage's id.

- [ ] **Step 1: Find the existing code**

Open `src/renderer/routes/documents_.$id.tsx`. Locate:
```ts
const STAGE_ID = 'china_utility.v1';
```
and:
```tsx
function RunExtractionAction({
  document,
  discardedHint,
}: {
  document: Document;
  discardedHint?: boolean;
}) {
  // ...
  const runExtraction = useMutation({
    mutationFn: async () => {
      setVisionPhase(false);
      return extractionApi.run({ document_id: document.id, stage_id: STAGE_ID });
    },
    // ...
  });
```

- [ ] **Step 2: Plumb a `stageId` prop into `RunExtractionAction`**

In `documents_.$id.tsx`, change the `DocumentReview` component to pass the right stage id down. Find the existing block:

```tsx
        <div className="overflow-y-auto">
          {extractionsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">{m.loading()}</p>
          ) : !activeExtraction ? (
            <RunExtractionAction document={document} discardedHint={hasDiscarded} />
          ) : (
            <ExtractionReview extraction={activeExtraction} document={document} />
          )}
        </div>
```

Replace with:
```tsx
        <div className="overflow-y-auto">
          {extractionsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">{m.loading()}</p>
          ) : !activeExtraction ? (
            <RunExtractionAction
              document={document}
              discardedHint={hasDiscarded}
              // Retry the same stage the user originally picked. If the
              // doc only ever had rejected extractions, the most-recent
              // rejected one's prompt_version is the right retry stage.
              // If there's no history at all, fall back to the default.
              stageId={extractions[0]?.prompt_version ?? STAGE_ID}
            />
          ) : (
            <ExtractionReview extraction={activeExtraction} document={document} />
          )}
        </div>
```

Then update the `RunExtractionAction` component signature + the mutation. Find:
```tsx
function RunExtractionAction({
  document,
  discardedHint,
}: {
  document: Document;
  discardedHint?: boolean;
}) {
```

Replace with:
```tsx
function RunExtractionAction({
  document,
  discardedHint,
  stageId,
}: {
  document: Document;
  discardedHint?: boolean;
  stageId: string;
}) {
```

Then find:
```tsx
    mutationFn: async () => {
      setVisionPhase(false);
      return extractionApi.run({ document_id: document.id, stage_id: STAGE_ID });
    },
```

Replace with:
```tsx
    mutationFn: async () => {
      setVisionPhase(false);
      return extractionApi.run({ document_id: document.id, stage_id: stageId });
    },
```

Leave the `const STAGE_ID = 'china_utility.v1';` constant where it is — it's now the fallback used in the parent's `extractions[0]?.prompt_version ?? STAGE_ID` expression.

- [ ] **Step 3: Verify typecheck + tests**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run --pool=threads 2>&1 | tail -5
```
Expected: clean typecheck; 312 tests passing.

- [ ] **Step 4: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/renderer/routes/documents_.$id.tsx
git commit -m "fix(ui): retry-after-discard now re-runs with the originally-picked stage id"
```

---

## Task 8: Integration test — vision path stays green for fuel_receipt

**Files:**
- Modify: `tests/main/services/extraction-service.test.ts`

Existing ExtractionService tests cover the china_utility happy path + vision fallback + discard/retry. Add ONE smoke test that confirms the orchestrator routes correctly for `fuel_receipt.v1`. Vision path coverage is already integration-tested for china_utility; fuel_receipt rides the same code, so we only need to confirm the stage lookup + INSERT works for the new id.

- [ ] **Step 1: Add the test**

Open `tests/main/services/extraction-service.test.ts`. Find the closing `});` of the top-level `describe('ExtractionService', () => { ... });` block (the file's penultimate line). Append the following test inside that describe, immediately before the closing `});`:

```ts
  it('run() routes fuel_receipt.v1 through the same pipeline (stage lookup + INSERT)', async () => {
    // Mirror the FAKE_EXTRACTION pattern but for fuel_receipt.v1's shape.
    const fuelExtraction = {
      doc_type: 'fuel_receipt' as const,
      supplier_name: '中国石化北京加油站',
      fuel_type: '92#汽油',
      fuel_category: 'gasoline' as const,
      volume_l: 38.5,
      unit_price_yuan: 7.85,
      amount_yuan: 302.23,
      occurred_at: '2026-04-15',
      license_plate: '京A12345',
      confidence: 'high' as const,
    };

    // Override the harness's LLM client to return the fuel-shaped object
    // when the orchestrator calls extract() with the fuel schema. We
    // verify the right stage_id was threaded through to the row.
    h.cleanup();
    h = setupHarness();
    h.llmClient = {
      extract: vi.fn().mockResolvedValue(fuelExtraction),
      extractWithImages: vi.fn(),
    } as unknown as LLMClient;

    // Re-build ExtractionService with the new llmClient (the harness's
    // setupHarness binds it at construction time).
    h.extractionService = new ExtractionService({
      db: h.db,
      now: () => '2026-05-13T00:00:00.000Z',
      documentService: h.documentService,
      settingsService: h.settingsService,
      llmClient: h.llmClient,
      readFile: () => Buffer.from('fuel-pdf-bytes'),
      parsePdf: vi.fn(async () => ({ text: 'FAKE_FUEL_TEXT' })),
    });

    const doc = uploadFakePdf(h.documentService);

    const ext = await h.extractionService.run({
      document_id: doc.id,
      stage_id: 'fuel_receipt.v1',
    });

    expect(ext.status).toBe('review_needed');
    expect(ext.prompt_version).toBe('fuel_receipt.v1');
    expect(JSON.parse(ext.parsed_json ?? '')).toEqual(fuelExtraction);
    // The LLM client got called with the fuel_receipt schema (we passed
    // it through; the orchestrator should pick the right stage).
    expect(h.llmClient.extract).toHaveBeenCalledTimes(1);
    const [, schema] = vi.mocked(h.llmClient.extract).mock.calls[0] ?? [];
    expect(schema).toBeDefined();
    // Schema instance check: importing fuelReceiptExtraction at the test
    // top would create a cyclical require pattern in some setups; we
    // sanity-check by parsing the fuel extraction through the schema
    // captured at the call site.
    expect(() => (schema as { parse: (x: unknown) => unknown }).parse(fuelExtraction)).not.toThrow();
  });
```

- [ ] **Step 2: Run the test to confirm it passes**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/services/extraction-service.test.ts --pool=threads
```
Expected: all existing extraction-service tests still pass, plus the new one — total +1 test.

- [ ] **Step 3: Run the full test suite**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -5
```
Expected: 313 tests passing (312 from prior tasks + 1 new).

- [ ] **Step 4: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add tests/main/services/extraction-service.test.ts
git commit -m "test(extraction): smoke test for fuel_receipt.v1 stage routing"
```

---

## Task 9: Full test + lint + typecheck sweep

**Files:** none — verification only.

- [ ] **Step 1: Run the full suite**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads
```
Expected: ≥313 tests passing.

- [ ] **Step 2: Run typecheck**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
```
Expected: clean exit (no output).

- [ ] **Step 3: Run lint + format**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm format && pnpm lint --max-diagnostics=80
```
Expected: format may rewrite a few lines (commit them); lint shows only the pre-existing `noNonNullAssertion` warnings and **0 errors**.

If format made changes, commit them:
```bash
cd /Users/lxz/ws/personal/carbonbook
git diff --stat
git add -A
git commit -m "chore: biome format pass for fuel_receipt stage"
```

(If `git diff` shows no changes, skip the commit.)

---

## Task 10: Manual smoke (user gate before tagging)

**Files:** none — execute with the user.

- [ ] **Step 1: Restart `pnpm dev` cleanly**

Tell the user to:
```bash
# in their existing pnpm dev terminal:
Ctrl+C
pnpm dev
```
Main process needs a full restart so the new registry entry + `stages:list` results reach the renderer.

- [ ] **Step 2: Provide a fuel receipt PDF for testing**

Ask the user to either supply a real Chinese gas-station PDF, or use the `/tmp/fake-fuel-receipt.html` test fixture (offer to generate one if they don't have a real PDF).

- [ ] **Step 3: Verify the happy path**

Have the user:
1. Restart pnpm dev → open /documents.
2. See the new "单据类型" dropdown above the upload zone with two options: "国网/南方电网风格 — 中国电费单" and "Chinese fuel receipt (加油单据) — classify + extract".
3. Pick "加油单据".
4. Drag a fuel receipt PDF in. Spinner shows "正在抽取…", potentially flips to "正在识别图像…" if it's a scan.
5. New row appears with "待审核" chip.
6. Click into doc detail. The right pane shows 8 fields: 供电公司 / 燃料品种 / 燃料大类 / 加油量 / 单价 / 总金额 / 加油日期 / 车牌号. Stage chip shows "Chinese fuel receipt (加油单据)" instead of the raw `fuel_receipt.v1`.
7. Click Confirm → ActivityForm prefilled with `amount=volume_l`, `unit='L'`, dates set, notes includes supplier + plate. User picks a vehicle emission_source + EF.
8. Submit → row in /activities → dashboard CO2e increments.

- [ ] **Step 4: Verify the `fuel_category='other'` warning UX**

(Optional, surface a non-fuel PDF if available.) If the model returns `fuel_category='other'`, the review pane should show a red warning chip telling the user to override before Confirm.

- [ ] **Step 5: Verify the retry-after-discard for fuel_receipt**

Have the user upload a fuel receipt, discard it, click [重新抽取]. The retry should re-run with `fuel_receipt.v1`, NOT china_utility.v1. (Watch the prompt_version chip after re-extraction completes.)

- [ ] **Step 6: Get user sign-off**

If all four paths work, proceed to commit the final cleanup commit (if format made any changes) and announce Sub-Project 1 of 5 complete.

---

## Closeout

This sub-project does NOT introduce a new git tag — the `phase-1d` tag is reserved for after all 4 stages + EF Matcher land. After Task 10 sign-off, this branch sits on `main` and the next sub-project (freight) starts its own brainstorm.

Expected end state:
- 313+ vitest tests passing
- 2 stages registered (`china_utility.v1`, `fuel_receipt.v1`)
- Upload zone has stage dropdown
- ExtractionReview renders per-stage fields + ActivityForm prefill
- Retry-after-discard preserves the original stage id
