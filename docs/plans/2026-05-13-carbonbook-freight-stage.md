# `freight.v1` Stage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the third extraction stage so Phase 1's "5 种典型单据" deliverable moves from 2/5 to 3/5. Users upload a Chinese freight document (公路 / 海运 / 铁路 / 航空), the AI extracts mode / weight / endpoints / amount / date, and the existing Confirm → ActivityForm → activity_data flow runs to completion.

**Architecture:** Single Stage<FreightExtraction> with a `mode: enum('road'|'rail'|'sea'|'air')` discriminator + a permissive `vehicle_class: string | null` for within-mode subtypes. Mirrors `fuel_receipt.v1` exactly in shape — schema + text prompt + vision prompt + registry entry. The only renderer-side change is adding a 3rd arm to ExtractionReview's per-stage switch (NOT a per-stage component split — that's Phase 1.5 work).

**Tech Stack:** TypeScript, AI SDK 6, zod, React 18, TanStack Router/Query, vitest, biome, paraglide i18n.

**Spec:** `docs/specs/2026-05-13-freight-stage-design.md` (commit `e5248f6`).

**Reference plan:** `docs/plans/2026-05-13-carbonbook-fuel-receipt-stage.md` (commit `8c196e8`) — this plan mirrors its task ordering and shape almost exactly. Differences are domain-specific (schema fields, prompt content, i18n keys) and the ExtractionReview switch becomes 3-arm instead of 2-arm.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/main/llm/stages/freight.ts` | **create** | `freightMode` zod enum (4 values), `freightExtraction` zod object schema (11 fields), `FreightExtraction` inferred type, `FreightMode` inferred type, `freightStage: Stage<FreightExtraction>` with `id='freight.v1'`, `buildPrompt` (text path) + `buildVisionMessages` (vision path) sharing a private `FIELD_RULES` constant. |
| `src/main/llm/stages/registry.ts` | modify | Add `freightStage` to the `_stageRegistry` Map (3rd entry). |
| `tests/main/llm/stages/freight.test.ts` | **create** | Mirror `fuel-receipt.test.ts`: schema accept/reject boundaries (12 tests), stage metadata (prompt content checks), registry integration. |
| `tests/main/llm/stages/registry.test.ts` | modify | Bump expected stage count 2 → 3 + add `freight.v1` to id-set assertions. |
| `messages/en.json`, `messages/zh-CN.json` | modify | 7 new field-label keys (mode / vehicle_class / weight_kg / volume_m3 / distance_km / origin / destination / tracking_no). |
| `src/renderer/components/ExtractionReview.tsx` | modify | Add `FreightParsed` type, `FreightFields` subcomponent, `buildFreightInitialValues` builder, add 3rd arm to per-stage `parsed.stage` switch in JSX. **DO NOT** refactor per-stage parts to their own files — that's Phase 1.5 work explicitly deferred in spec §7. File will land at ~520 LOC; this is intentional. |
| `tests/main/services/extraction-service.test.ts` | modify | One new smoke test mirroring the fuel_receipt one (Task 8 of fuel_receipt plan) — verifies stage_id routing + schema reachability. |

---

## Task 1: `freight.ts` schema + types

**Files:**
- Create: `src/main/llm/stages/freight.ts`
- Test: `tests/main/llm/stages/freight.test.ts`

This task lands the schema + an empty stage shell. Prompt content is added in Task 2; this task isolates the schema concerns from the prompt content so the test surface is clear.

- [ ] **Step 1: Write the failing schema tests**

Create `tests/main/llm/stages/freight.test.ts`:

```ts
import {
  type FreightExtraction,
  freightExtraction,
  freightStage,
} from '@main/llm/stages/freight';
import { describe, expect, it } from 'vitest';

/**
 * Canonical happy-path extraction shape. Branch off this baseline and
 * tweak one field per test to assert acceptance / rejection.
 */
const GOOD: FreightExtraction = {
  doc_type: 'freight',
  supplier_name: '顺丰速运',
  mode: 'road',
  vehicle_class: '冷链车',
  weight_kg: 1250,
  volume_m3: 4.5,
  distance_km: 1430,
  origin: '广州市番禺区',
  destination: '上海市浦东新区',
  tracking_no: 'SF1234567890',
  amount_yuan: 2680,
  occurred_at: '2026-05-08',
  confidence: 'high',
};

describe('freightExtraction schema', () => {
  it('accepts a fully populated freight JSON', () => {
    expect(freightExtraction.parse(GOOD)).toEqual(GOOD);
  });

  it('accepts the 4 nullable fields set to null (vehicle_class, volume_m3, distance_km, tracking_no)', () => {
    const parsed = freightExtraction.parse({
      ...GOOD,
      vehicle_class: null,
      volume_m3: null,
      distance_km: null,
      tracking_no: null,
    });
    expect(parsed.vehicle_class).toBeNull();
    expect(parsed.volume_m3).toBeNull();
    expect(parsed.distance_km).toBeNull();
    expect(parsed.tracking_no).toBeNull();
  });

  it('accepts permissive zero values for weight_kg and amount_yuan', () => {
    expect(() => freightExtraction.parse({ ...GOOD, weight_kg: 0 })).not.toThrow();
    expect(() => freightExtraction.parse({ ...GOOD, amount_yuan: 0 })).not.toThrow();
  });

  it('accepts empty origin / destination strings (permissive)', () => {
    expect(() => freightExtraction.parse({ ...GOOD, origin: '' })).not.toThrow();
    expect(() => freightExtraction.parse({ ...GOOD, destination: '' })).not.toThrow();
  });

  it('accepts non-ISO / empty occurred_at strings (permissive)', () => {
    expect(() =>
      freightExtraction.parse({ ...GOOD, occurred_at: '2026/05/08' }),
    ).not.toThrow();
    expect(() => freightExtraction.parse({ ...GOOD, occurred_at: '' })).not.toThrow();
  });

  it('rejects negative weight_kg', () => {
    expect(() => freightExtraction.parse({ ...GOOD, weight_kg: -1 })).toThrow();
  });

  it('rejects negative amount_yuan', () => {
    expect(() => freightExtraction.parse({ ...GOOD, amount_yuan: -1 })).toThrow();
  });

  it('rejects negative volume_m3 and distance_km', () => {
    expect(() => freightExtraction.parse({ ...GOOD, volume_m3: -0.1 })).toThrow();
    expect(() => freightExtraction.parse({ ...GOOD, distance_km: -10 })).toThrow();
  });

  it('rejects an unknown mode value', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
      freightExtraction.parse({ ...GOOD, mode: 'spaceship' } as any),
    ).toThrow();
  });

  it('accepts each of the 4 valid mode values', () => {
    for (const mode of ['road', 'rail', 'sea', 'air'] as const) {
      expect(() => freightExtraction.parse({ ...GOOD, mode })).not.toThrow();
    }
  });

  it('rejects an unknown confidence value', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
      freightExtraction.parse({ ...GOOD, confidence: 'definitely' } as any),
    ).toThrow();
  });

  it('rejects a doc_type other than the literal "freight"', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
      freightExtraction.parse({ ...GOOD, doc_type: 'fuel_receipt' } as any),
    ).toThrow();
  });
});

describe('freightStage metadata', () => {
  it('exposes id="freight.v1", version, inputType, and prompt builders', () => {
    expect(freightStage.id).toBe('freight.v1');
    expect(freightStage.version).toBe('1.0.0');
    expect(freightStage.inputType).toBe('pdf_text');
    expect(typeof freightStage.buildPrompt).toBe('function');
    expect(typeof freightStage.buildVisionMessages).toBe('function');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/llm/stages/freight.test.ts --pool=threads
```
Expected: FAIL with "Cannot find module '@main/llm/stages/freight'".

- [ ] **Step 3: Create the schema-only module**

Create `src/main/llm/stages/freight.ts`:

```ts
import { z } from 'zod';
import type { Stage, VisionMessages } from './types.js';

/**
 * Transport mode discriminator. The 4 buckets cover everything
 * carbonbook accounts for in Phase 1 freight scope. Multi-modal
 * shipments (海铁联运) pick the dominant mode and lower their
 * confidence — full multi-mode handling is deferred until real-user
 * usage demands it.
 *
 * Mapping intent (model gets this verbatim in the prompt):
 *   - 公路货车 / 卡车 / 货拉拉 / 顺丰快递 / 最后一公里     → 'road'
 *   - 铁路 / 中欧班列 / X-list 班次                          → 'rail'
 *   - 海运 / 集装箱 / 散货 / 港到港                          → 'sea'
 *   - 航空货运 / 货机 / 客机腹舱 / AWB                       → 'air'
 */
export const freightMode = z.enum(['road', 'rail', 'sea', 'air']);
export type FreightMode = z.infer<typeof freightMode>;

/**
 * Structured output schema for a Chinese freight / shipping document
 * (运输单 / 物流单 / 提单).
 *
 * Shape strict, values permissive — same contract as
 * `china_utility.v1` and `fuel_receipt.v1`. Numeric fields use
 * `.min(0)` so the model can emit zero as an "I cannot read this"
 * signal. 4 fields are nullable (`vehicle_class`, `volume_m3`,
 * `distance_km`, `tracking_no`) because they're commonly absent or
 * mode-specific.
 *
 * The mode discriminator plus a free-form `vehicle_class` mirrors
 * fuel_receipt's two-tier typing: `mode` drives the EF lookup
 * downstream, `vehicle_class` preserves the receipt's literal
 * subtype for audit + future EF refinement.
 *
 * `distance_km` is nullable BY DESIGN — the LLM is forbidden from
 * estimating it from origin/destination strings (see prompt). The
 * EF Matcher (Phase 1.5) is responsible for filling distance from
 * a routing API at Confirm time when the receipt didn't show it.
 */
export const freightExtraction = z.object({
  doc_type: z.literal('freight').describe('Always the literal "freight".'),
  supplier_name: z
    .string()
    .describe(
      'Carrier / logistics provider name, e.g. "中远海运", "顺丰速运", ' +
        '"中铁集装箱". Empty string if not legible.',
    ),
  mode: freightMode.describe(
    'Transport mode discriminator. road = trucks / vans / last-mile; ' +
      'rail = 铁路 / 中欧班列; sea = ocean container or bulk; ' +
      'air = air cargo (freighter or belly hold).',
  ),
  vehicle_class: z
    .string()
    .nullable()
    .describe(
      'Free-text within-mode subtype: road may show "8 轴货车" or "冷链车" ' +
        'or "液化气罐车"; sea shows "20ft 集装箱" / "40ft" / "散货"; rail shows ' +
        '"C70" or "X70"; air shows "B777F" or "客机腹舱". null if not legible.',
    ),
  weight_kg: z
    .number()
    .min(0)
    .describe(
      'Cargo gross weight in KILOGRAMS. If the receipt shows "吨/T", multiply ' +
        'by 1000. If "千克/公斤/kg", direct. 0 if not legible — UI flags.',
    ),
  volume_m3: z
    .number()
    .min(0)
    .nullable()
    .describe(
      'Cargo volume in cubic meters. Mostly relevant for air (volumetric ' +
        'weight) and occasionally LCL ocean. null if absent.',
    ),
  distance_km: z
    .number()
    .min(0)
    .nullable()
    .describe(
      'Transport distance in kilometers. Fill ONLY if an explicit numeric ' +
        'distance appears on the receipt. Do NOT estimate from origin/' +
        'destination strings — leave null. The EF Matcher fills this at ' +
        'Confirm time using a routing API.',
    ),
  origin: z
    .string()
    .describe(
      'Origin / loading location (free-form, e.g. "深圳市宝安区", "Hamburg", ' +
        '"Shanghai Yangshan Port"). Empty string if not legible.',
    ),
  destination: z
    .string()
    .describe(
      'Destination / unloading location. Empty string if not legible. ' +
        'Format follows the receipt — no normalization.',
    ),
  tracking_no: z
    .string()
    .nullable()
    .describe(
      'Single tracking identifier — picks the most prominent of: sea bill of ' +
        'lading (B/L) number, sea container number (e.g. CSQU3054383), rail ' +
        'train number / waybill, road waybill / 货运单号, air air waybill ' +
        '(AWB) number. null if absent.',
    ),
  amount_yuan: z
    .number()
    .min(0)
    .describe(
      'Total freight charges in CNY (元 / 应付运费 / 总费用). 0 if not legible.',
    ),
  occurred_at: z
    .string()
    .describe(
      'Shipment / loading date as YYYY-MM-DD. Freight is a single-point event ' +
        'for accounting purposes (both start and end set to this date). Empty ' +
        'string if not legible. If both loading and delivery dates appear, use ' +
        'the LOADING date.',
    ),
  confidence: z
    .enum(['high', 'medium', 'low'])
    .describe(
      'high: supplier_name + mode + weight_kg + origin + destination + ' +
        'amount_yuan + occurred_at all clearly visible. medium: 1-2 inferred ' +
        'or partially obscured. low: not a freight document, OR multiple ' +
        'required fields are guesses, OR mode is ambiguous.',
    ),
});

export type FreightExtraction = z.infer<typeof freightExtraction>;

/**
 * v1 Chinese-freight stage. Mirrors `fuelReceiptStage` structure:
 * one schema, one text-path prompt, one vision-path prompt, both
 * sharing a private FIELD_RULES const.
 *
 * Prompt body lands in Task 2 of the implementation plan; this stub
 * exists so the registry wiring + metadata tests can pass first.
 */
export const freightStage: Stage<FreightExtraction> = {
  id: 'freight.v1',
  version: '1.0.0',
  description: 'Chinese freight (运输单据) — classify + extract',
  inputType: 'pdf_text',
  schema: freightExtraction,
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
pnpm vitest run tests/main/llm/stages/freight.test.ts --pool=threads
```
Expected: PASS — 13 tests passing (12 schema + 1 metadata).

Also run typecheck:
```bash
pnpm typecheck
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/main/llm/stages/freight.ts tests/main/llm/stages/freight.test.ts
git commit -m "feat(stages): freight.v1 — schema + stage shell"
```

---

## Task 2: `freight.ts` prompts (text + vision)

**Files:**
- Modify: `src/main/llm/stages/freight.ts`
- Test: `tests/main/llm/stages/freight.test.ts`

- [ ] **Step 1: Add prompt-content assertions to the metadata test**

Open `tests/main/llm/stages/freight.test.ts`. Replace the existing single `it('exposes id="freight.v1"...')` test inside `describe('freightStage metadata', ...)` with the following three assertions:

```ts
describe('freightStage metadata', () => {
  it('exposes id="freight.v1", version, inputType, and prompt builders', () => {
    expect(freightStage.id).toBe('freight.v1');
    expect(freightStage.version).toBe('1.0.0');
    expect(freightStage.inputType).toBe('pdf_text');
    expect(typeof freightStage.buildPrompt).toBe('function');
    expect(typeof freightStage.buildVisionMessages).toBe('function');
  });

  it('buildPrompt embeds the PDF text inside <receipt>...</receipt> AND includes field rules', () => {
    const prompt = freightStage.buildPrompt('SAMPLE_FREIGHT_TEXT_TOKEN');
    expect(prompt).toContain('Chinese freight');
    expect(prompt).toContain('SAMPLE_FREIGHT_TEXT_TOKEN');
    expect(prompt).toContain('<receipt>');
    expect(prompt).toContain('</receipt>');
    // Field rules verbatim shared with vision path.
    expect(prompt).toContain('mode');
    expect(prompt).toContain('weight_kg');
    // Each of the 4 mode enum values appears in the prompt body.
    expect(prompt).toContain('road');
    expect(prompt).toContain('rail');
    expect(prompt).toContain('sea');
    expect(prompt).toContain('air');
    // The "do not estimate distance" guidance is verbatim.
    expect(prompt).toContain('Do NOT estimate');
  });

  it('buildVisionMessages mirrors buildPrompt field rules but omits the <receipt> placeholder', () => {
    const msgs = freightStage.buildVisionMessages?.();
    expect(msgs).toBeDefined();
    expect(msgs?.userText).toContain('Chinese freight');
    expect(msgs?.userText).toContain('mode');
    expect(msgs?.userText).toContain('weight_kg');
    expect(msgs?.userText).toContain('Do NOT estimate');
    // No PDF text placeholder — image content is appended by the caller.
    expect(msgs?.userText).not.toContain('<receipt>');
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/llm/stages/freight.test.ts --pool=threads
```
Expected: 12 schema tests still pass; 2 of the 3 metadata tests fail (the prompt-content assertions).

- [ ] **Step 3: Replace the stub prompts with the real ones**

In `src/main/llm/stages/freight.ts`, replace the entire `freightStage` export at the bottom (everything from the JSDoc comment above `export const freightStage` onward) with:

```ts
/**
 * Field-mapping + output-format rules shared between `buildPrompt`
 * (text path) and `buildVisionMessages` (image path). Extracting this
 * to a const guarantees the two paths stay aligned. Same DRY pattern as
 * china_utility.v1 and fuel_receipt.v1.
 */
const FIELD_RULES = `Output rules (CRITICAL — DeepSeek and other providers without native JSON
schema mode read these directly):
- Return EXACTLY ONE JSON object, no markdown, no \`\`\`json fences, no prose.
- Every required field must be present. Numeric fields are numbers (not
  strings). Date fields are strings in ISO format "YYYY-MM-DD".
- If a value is genuinely missing on the receipt, use null ONLY for the
  four fields explicitly marked nullable (vehicle_class, volume_m3,
  distance_km, tracking_no). Never omit a key. Never use null for
  required fields — emit a best-guess instead with confidence='low'.

Field mapping (Chinese freight documents follow many regional variations):
- doc_type: always "freight".
- supplier_name: the carrier / logistics provider, e.g.
  "中远海运" / "顺丰速运" / "中铁集装箱" / "DHL".
- mode: transport-mode discriminator (one of road/rail/sea/air):
  - road:  公路货车 / 卡车 / 货拉拉 / 顺丰快递 / 最后一公里
  - rail:  铁路 / 中欧班列 / X-list 班次
  - sea:   海运 / 集装箱 / 散货 / 港到港 / Bill of Lading (BL)
  - air:   航空货运 / 货机 / 客机腹舱 / Air Waybill (AWB)
  If multi-modal (e.g. 海铁联运), pick the dominant leg and set
  confidence='medium'.
- vehicle_class: free-text within-mode subtype.
  - road:  "8 轴货车" / "冷链车" / "液化气罐车" / "厢式货车"
  - sea:   "20ft 集装箱" / "40ft 集装箱" / "散货"
  - rail:  "C70" / "X70" / "中欧班列"
  - air:   "B777F" / "B747F" / "客机腹舱"
  null if not legible — affects only EF refinement.
- weight_kg: numeric KILOGRAMS.
  - "千克" / "kg" / "公斤"  → kg directly.
  - "吨" / "T" / "tonne" → multiply by 1000.
  - "克" / "g" → divide by 1000.
  - "磅" / "lb" → multiply by 0.4536 (and set confidence='medium').
  0 if not legible.
- volume_m3: numeric cubic meters (立方米 / m³ / CBM). null if absent.
- distance_km: numeric kilometers — fill ONLY if an explicit distance
  number appears on the receipt (e.g. highway toll receipt, some 中欧
  班列 documents print mileage). Do NOT estimate from origin /
  destination strings. Wrong example: "深圳 → 汉堡" → "distance_km:
  19000" is WRONG. Leave it null. The downstream EF Matcher will fill
  distance from a routing API.
- origin: free-form loading location, e.g. "深圳市宝安区" / "Hamburg" /
  "Shanghai Yangshan Port". Empty string if not legible.
- destination: free-form unloading location.
- tracking_no: pick the most prominent of: BL number, container number,
  train number, road waybill, AWB number. Use one canonical string.
  null if absent.
- amount_yuan: total CNY paid ("应付运费" / "总费用" / "Total Charges").
  Number only (no "¥" / "元"). 0 if not legible.
- occurred_at: loading / shipment date as ISO YYYY-MM-DD. If both
  loading and delivery dates appear, use the LOADING date. If only
  year-month shown ("2026-05"), assume the 15th. Empty string if not
  legible.
- confidence:
  - "high" if supplier, mode, weight_kg, origin, destination,
    amount_yuan, occurred_at are all clearly visible and unambiguous.
  - "medium" if one or two were inferred, OR a unit conversion was
    applied (吨 → kg, lb → kg), OR mode was inferred from context.
  - "low" if the document doesn't look like a freight document at all,
    OR multiple required fields are guesses, OR mode is ambiguous.

Ignore (DO NOT include in the output): payment method (cash/card/wire),
fapiao receipt number, customs declaration code, cargo description
detail, insurance number, surcharge breakdown.

Example valid response shape (do not copy the values — extract from the
real receipt):
{"doc_type":"freight","supplier_name":"顺丰速运","mode":"road","vehicle_class":"冷链车","weight_kg":1250,"volume_m3":4.5,"distance_km":null,"origin":"广州市番禺区","destination":"上海市浦东新区","tracking_no":"SF1234567890","amount_yuan":2680,"occurred_at":"2026-05-08","confidence":"high"}`;

/**
 * v1 Chinese-freight stage. Mirrors `fuelReceiptStage`:
 * - same Stage<T> shape;
 * - text path uses <receipt>${pdfText}</receipt> wrapper analogous to
 *   the other stages;
 * - vision path swaps the wrapper for an "images attached" hint and
 *   reuses FIELD_RULES verbatim;
 * - prompt is in English (instruction-following) while the receipt
 *   content stays Chinese.
 */
export const freightStage: Stage<FreightExtraction> = {
  id: 'freight.v1',
  version: '1.0.0',
  description: 'Chinese freight (运输单据) — classify + extract',
  inputType: 'pdf_text',
  schema: freightExtraction,
  buildPrompt: (pdfText: string) => `
You are extracting structured data from a Chinese freight / shipping document (运输单 / 物流单 / 提单).

Receipt text (extracted from PDF):
<receipt>
${pdfText}
</receipt>

${FIELD_RULES}`,
  buildVisionMessages: (): VisionMessages => ({
    userText: `You are extracting structured data from a Chinese freight / shipping document (运输单 / 物流单 / 提单).

The receipt is provided as one or more PNG images (one per PDF page) attached to this
message. Look at the images directly — do NOT request OCR text from another tool.

If the PDF shows multiple shipments batched together, extract the most prominent /
largest one and set confidence='low'.

${FIELD_RULES}`,
  }),
};
```

- [ ] **Step 4: Run all tests to confirm green**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/llm/stages/freight.test.ts --pool=threads
pnpm typecheck
```
Expected: 15 tests passing (12 schema + 3 metadata). typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/main/llm/stages/freight.ts tests/main/llm/stages/freight.test.ts
git commit -m "feat(stages): freight.v1 — text + vision prompts with shared FIELD_RULES"
```

---

## Task 3: Register `freightStage`

**Files:**
- Modify: `src/main/llm/stages/registry.ts`
- Modify: `tests/main/llm/stages/registry.test.ts`
- Test: append to `tests/main/llm/stages/freight.test.ts`

- [ ] **Step 1: Add a registration test**

Open `tests/main/llm/stages/freight.test.ts` and append the following describe block at the end of the file (after all existing describes):

```ts
import { getStage, listStages } from '@main/llm/stages/registry';

describe('freightStage registry integration', () => {
  it('is returned by getStage("freight.v1")', () => {
    expect(getStage('freight.v1')).toBe(freightStage);
  });

  it('appears in listStages() alongside the existing 2 stages', () => {
    const ids = listStages().map((s) => s.id);
    expect(ids).toContain('freight.v1');
    expect(ids).toContain('fuel_receipt.v1');
    expect(ids).toContain('china_utility.v1');
  });
});
```

Hoist the `import { getStage, listStages } from '@main/llm/stages/registry'` import up to the file's import block (next to the existing imports) rather than leaving it inline at the bottom.

- [ ] **Step 2: Update the existing registry test to expect 3 stages**

Open `tests/main/llm/stages/registry.test.ts`. Read the existing assertions — they currently expect 2 stages (`china_utility.v1`, `fuel_receipt.v1`). Update each:

1. Any `stageRegistry.size === 2` or `listStages().length === 2` assertion → change to `=== 3`.
2. Any id-set assertion that includes the existing 2 ids → also include `'freight.v1'`.
3. Test names that say "2 stages" or "both registered stages" → update to "3 stages" / "all registered stages".

(Read the file first to find the exact assertions; the pattern was established when `fuel_receipt.v1` registered in commit `ab758b1`.)

- [ ] **Step 3: Run tests to verify the new ones fail**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/llm/stages/freight.test.ts tests/main/llm/stages/registry.test.ts --pool=threads
```
Expected: 15 prior freight tests still pass; 2 new registry-integration tests fail (`getStage` returns undefined). The registry.test.ts updates from Step 2 will also fail until Step 4 lands the registration.

- [ ] **Step 4: Add the registry entry**

Open `src/main/llm/stages/registry.ts`. Current state (after fuel_receipt landed):
```ts
import { chinaUtilityStage } from './china-utility.js';
import { fuelReceiptStage } from './fuel-receipt.js';
import type { Stage } from './types.js';

const _stageRegistry = new Map<string, Stage>([
  [chinaUtilityStage.id, chinaUtilityStage as Stage],
  [fuelReceiptStage.id, fuelReceiptStage as Stage],
]);
```

Replace ONLY the imports + Map literal with:
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

Leave the rest of the file (`stageRegistry`, `getStage`, `listStages`, `registerStage`) UNCHANGED.

- [ ] **Step 5: Run all tests to confirm green**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads
pnpm typecheck
```
Expected: 328 tests passing (326 from prior tasks + 2 new from the freight registry tests; the existing registry.test.ts assertions updated to expect 3 stages). typecheck clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/main/llm/stages/registry.ts \
        tests/main/llm/stages/freight.test.ts \
        tests/main/llm/stages/registry.test.ts
git commit -m "feat(stages): register freight.v1 in stage registry"
```

---

## Task 4: i18n strings

**Files:**
- Modify: `messages/en.json`
- Modify: `messages/zh-CN.json`

Add 7 new keys for the fields that fuel_receipt doesn't already cover. The other 4 freight fields (supplier, amount_yuan, confidence, occurred_at) reuse existing i18n keys.

- [ ] **Step 1: Validate JSON is well-formed before edits**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
node -e "JSON.parse(require('fs').readFileSync('messages/en.json', 'utf8')); JSON.parse(require('fs').readFileSync('messages/zh-CN.json', 'utf8')); console.log('OK');"
```
Expected: `OK`.

- [ ] **Step 2: Add new keys to en.json**

Open `messages/en.json`. Find the existing line `"documents_upload_pick_stage": "Document type",` (added by fuel_receipt Task 4) and INSERT the following 7 keys IMMEDIATELY AFTER it:

```json
  "documents_review_field_mode": "Transport mode",
  "documents_review_field_vehicle_class": "Vehicle class",
  "documents_review_field_weight_kg": "Weight (kg)",
  "documents_review_field_volume_m3": "Volume (m³)",
  "documents_review_field_distance_km": "Distance (km)",
  "documents_review_field_origin": "Origin",
  "documents_review_field_destination": "Destination",
  "documents_review_field_tracking_no": "Tracking no.",
```

(That's 8 lines / 8 keys — the spec §4 §5 list 7 i18n keys; tracking_no is the 8th. Including all 8 here for completeness.)

- [ ] **Step 3: Add new keys to zh-CN.json**

Open `messages/zh-CN.json`. Find the existing line `"documents_upload_pick_stage": "单据类型",` and INSERT the following 8 keys IMMEDIATELY AFTER it:

```json
  "documents_review_field_mode": "运输方式",
  "documents_review_field_vehicle_class": "车型/箱型",
  "documents_review_field_weight_kg": "重量（kg）",
  "documents_review_field_volume_m3": "体积（m³）",
  "documents_review_field_distance_km": "距离（km）",
  "documents_review_field_origin": "起运地",
  "documents_review_field_destination": "目的地",
  "documents_review_field_tracking_no": "运单/箱号",
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
git commit -m "feat(i18n): freight field labels"
```

---

## Task 5: `ExtractionReview` — 3rd arm for freight

**Files:**
- Modify: `src/renderer/components/ExtractionReview.tsx`

⚠️ **DO NOT REFACTOR**: this file will land at ~520 LOC after this task. That's intentional. Spec §4 / §7 of the freight design EXPLICITLY defer per-stage component splitting to Phase 1.5. Stick to adding a 3rd arm — do NOT pull `ChinaUtilityFields`, `FuelReceiptFields`, `FreightFields` into separate files. The refactor happens when travel.v1 lands.

The current file (after fuel_receipt Task 6) has:
- 2 parsed types: `ChinaUtilityParsed`, `FuelReceiptParsed`
- 2-arm discriminated union `StageParsed`
- 2 Field-block subcomponents
- 2 initial-values builders
- Ternary switching on `parsed.stage` in JSX

You're adding the 3rd of each.

- [ ] **Step 1: Read the current ExtractionReview shape to confirm the insertion points**

The file has clear `---` comment dividers between sections:
- `// Per-stage parsed types + parsers`
- `// Confidence chip mapping`
- `// Component`
- `// Per-stage <dl> field blocks`
- `// ActivityForm prefill builders (per stage)`
- `// Generic field row`

You're adding to four of these sections.

- [ ] **Step 2: Add `FreightParsed` type and extend the discriminated union**

Find the existing block:
```ts
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
```

Replace with:
```ts
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

type FreightParsed = {
  doc_type?: string;
  supplier_name?: string;
  mode?: 'road' | 'rail' | 'sea' | 'air';
  vehicle_class?: string | null;
  weight_kg?: number;
  volume_m3?: number | null;
  distance_km?: number | null;
  origin?: string;
  destination?: string;
  tracking_no?: string | null;
  amount_yuan?: number;
  occurred_at?: string;
  confidence?: 'high' | 'medium' | 'low';
};

type StageParsed =
  | { stage: 'china_utility.v1'; data: ChinaUtilityParsed }
  | { stage: 'fuel_receipt.v1'; data: FuelReceiptParsed }
  | { stage: 'freight.v1'; data: FreightParsed };
```

- [ ] **Step 3: Extend the `parseExtraction` switch**

Find:
```ts
  if (promptVersion === 'china_utility.v1') {
    return { stage: 'china_utility.v1', data: obj as ChinaUtilityParsed };
  }
  if (promptVersion === 'fuel_receipt.v1') {
    return { stage: 'fuel_receipt.v1', data: obj as FuelReceiptParsed };
  }
  return null;
```

Replace with:
```ts
  if (promptVersion === 'china_utility.v1') {
    return { stage: 'china_utility.v1', data: obj as ChinaUtilityParsed };
  }
  if (promptVersion === 'fuel_receipt.v1') {
    return { stage: 'fuel_receipt.v1', data: obj as FuelReceiptParsed };
  }
  if (promptVersion === 'freight.v1') {
    return { stage: 'freight.v1', data: obj as FreightParsed };
  }
  return null;
```

- [ ] **Step 4: Add `FreightFields` subcomponent**

Find the existing `FuelReceiptFields` function (in the `Per-stage <dl> field blocks` section). Append immediately AFTER it:

```tsx
function FreightFields({ data }: { data: FreightParsed }) {
  return (
    <dl className="grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-4">
      <Field label={m.documents_review_field_supplier()} value={data.supplier_name} />
      <Field label={m.documents_review_field_mode()} value={data.mode} />
      <Field label={m.documents_review_field_vehicle_class()} value={data.vehicle_class} />
      <Field
        label={m.documents_review_field_weight_kg()}
        value={typeof data.weight_kg === 'number' ? `${data.weight_kg} kg` : undefined}
      />
      <Field
        label={m.documents_review_field_volume_m3()}
        value={typeof data.volume_m3 === 'number' ? `${data.volume_m3} m³` : undefined}
      />
      <Field
        label={m.documents_review_field_distance_km()}
        value={typeof data.distance_km === 'number' ? `${data.distance_km} km` : undefined}
      />
      <Field label={m.documents_review_field_origin()} value={data.origin} />
      <Field label={m.documents_review_field_destination()} value={data.destination} />
      <Field label={m.documents_review_field_tracking_no()} value={data.tracking_no} />
      <Field
        label={m.documents_review_field_amount_yuan()}
        value={typeof data.amount_yuan === 'number' ? `¥${data.amount_yuan}` : undefined}
      />
      <Field label={m.documents_review_field_occurred_at()} value={data.occurred_at} />
    </dl>
  );
}
```

- [ ] **Step 5: Add `buildFreightInitialValues` builder**

Find the existing `buildFuelReceiptInitialValues` function (in the `ActivityForm prefill builders (per stage)` section). Append immediately AFTER it:

```ts
/**
 * Freight prefill: amount in kg (raw, not tonne-km — distance is
 * usually null at this stage and EF Matcher Phase 1.5 will convert to
 * tonne-km), single-day event (start = end), supplier + endpoints +
 * mode + tracking_no in notes.
 *
 * The `unit='kg'` choice + per-kg freight EFs (Phase 1 manual EF
 * Matcher path) gives a non-zero CO2e on Confirm even when distance
 * is unknown. Once Phase 1.5 EF Matcher lands, this builder switches
 * to `amount = weight_kg * distance_km / 1000, unit='tonne-km'`.
 */
function buildFreightInitialValues(
  data: FreightParsed,
  filename: string,
): import('@renderer/components/ActivityForm').ActivityFormInitialValues {
  const notesParts = [`Auto-extracted from: ${filename}`];
  if (data.supplier_name) notesParts.push(`Supplier: ${data.supplier_name}`);
  if (data.origin || data.destination) {
    notesParts.push(`${data.origin ?? '?'} → ${data.destination ?? '?'}`);
  }
  if (data.mode) notesParts.push(`Mode: ${data.mode}`);
  if (data.tracking_no) notesParts.push(`Tracking: ${data.tracking_no}`);
  const out: import('@renderer/components/ActivityForm').ActivityFormInitialValues = {
    unit: 'kg',
    notes: notesParts.join(' · '),
  };
  if (data.occurred_at) {
    out.occurred_at_start = data.occurred_at;
    out.occurred_at_end = data.occurred_at;
  }
  if (typeof data.weight_kg === 'number') out.amount = String(data.weight_kg);
  return out;
}
```

- [ ] **Step 6: Extend the JSX field-block switch**

Find the existing JSX block (inside the main `return (...)` of `ExtractionReview`):
```tsx
        {parsed.stage === 'china_utility.v1' ? (
          <ChinaUtilityFields data={parsed.data} />
        ) : (
          <FuelReceiptFields data={parsed.data} />
        )}
```

Replace with:
```tsx
        {parsed.stage === 'china_utility.v1' ? (
          <ChinaUtilityFields data={parsed.data} />
        ) : parsed.stage === 'fuel_receipt.v1' ? (
          <FuelReceiptFields data={parsed.data} />
        ) : (
          <FreightFields data={parsed.data} />
        )}
```

- [ ] **Step 7: Extend the ActivityForm `initialValues` switch**

Find:
```tsx
          initialValues={
            parsed.stage === 'china_utility.v1'
              ? buildChinaUtilityInitialValues(parsed.data, document.filename)
              : buildFuelReceiptInitialValues(parsed.data, document.filename)
          }
```

Replace with:
```tsx
          initialValues={
            parsed.stage === 'china_utility.v1'
              ? buildChinaUtilityInitialValues(parsed.data, document.filename)
              : parsed.stage === 'fuel_receipt.v1'
                ? buildFuelReceiptInitialValues(parsed.data, document.filename)
                : buildFreightInitialValues(parsed.data, document.filename)
          }
```

- [ ] **Step 8: Verify typecheck + lint + tests**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run --pool=threads 2>&1 | tail -5
pnpm lint --max-diagnostics=80 2>&1 | grep "ExtractionReview" | head
```

Expected:
- typecheck: clean (TypeScript narrows `parsed.data` correctly via the discriminated union)
- vitest: 328 tests passing (no test added/removed in this task)
- lint: no new errors on ExtractionReview.tsx

- [ ] **Step 9: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/renderer/components/ExtractionReview.tsx
git commit -m "feat(ui): ExtractionReview — add freight.v1 3rd arm to per-stage switch"
```

---

## Task 6: Integration smoke — orchestrator routes freight.v1

**Files:**
- Modify: `tests/main/services/extraction-service.test.ts`

Mirrors Task 8 of fuel_receipt: one new smoke test confirming `ExtractionService.run()` routes `freight.v1` correctly through stage lookup + INSERT.

- [ ] **Step 1: Add the test**

Open `tests/main/services/extraction-service.test.ts`. Find the closing `});` of the top-level `describe('ExtractionService', () => { ... });` block (the file's penultimate line). Append the following test inside that describe, immediately before the closing `});`:

```ts
  it('run() routes freight.v1 through the same pipeline (stage lookup + INSERT)', async () => {
    // Mirror the fuel_receipt smoke pattern for freight.v1.
    const freightOutput = {
      doc_type: 'freight' as const,
      supplier_name: '顺丰速运',
      mode: 'road' as const,
      vehicle_class: '冷链车',
      weight_kg: 1250,
      volume_m3: 4.5,
      distance_km: null,
      origin: '广州市番禺区',
      destination: '上海市浦东新区',
      tracking_no: 'SF1234567890',
      amount_yuan: 2680,
      occurred_at: '2026-05-08',
      confidence: 'high' as const,
    };

    h.cleanup();
    h = setupHarness();
    h.llmClient = {
      extract: vi.fn().mockResolvedValue(freightOutput),
      extractWithImages: vi.fn(),
    } as unknown as LLMClient;

    h.extractionService = new ExtractionService({
      db: h.db,
      now: () => '2026-05-13T00:00:00.000Z',
      documentService: h.documentService,
      settingsService: h.settingsService,
      llmClient: h.llmClient,
      readFile: () => Buffer.from('freight-pdf-bytes'),
      parsePdf: vi.fn(async () => ({ text: 'FAKE_FREIGHT_TEXT' })),
    });

    const doc = uploadFakePdf(h.documentService);

    const ext = await h.extractionService.run({
      document_id: doc.id,
      stage_id: 'freight.v1',
    });

    expect(ext.status).toBe('review_needed');
    expect(ext.prompt_version).toBe('freight.v1');
    expect(JSON.parse(ext.parsed_json ?? '')).toEqual(freightOutput);
    expect(h.llmClient.extract).toHaveBeenCalledTimes(1);
    // Schema captured at the call site can parse the freight output —
    // proves the orchestrator passed freight.v1's schema, not another
    // stage's. Mirrors the technique used for fuel_receipt smoke.
    const [, schema] = vi.mocked(h.llmClient.extract).mock.calls[0] ?? [];
    expect(schema).toBeDefined();
    expect(() =>
      (schema as { parse: (x: unknown) => unknown }).parse(freightOutput),
    ).not.toThrow();
  });
```

- [ ] **Step 2: Run the test to confirm it passes**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/services/extraction-service.test.ts --pool=threads
```
Expected: all existing tests pass, +1 new = total 19 extraction-service tests.

- [ ] **Step 3: Run the full suite**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -5
```
Expected: 329 tests passing (328 from prior + 1 new).

- [ ] **Step 4: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add tests/main/services/extraction-service.test.ts
git commit -m "test(extraction): smoke test for freight.v1 stage routing"
```

---

## Task 7: Full test + lint sweep

**Files:** none — verification only.

- [ ] **Step 1: Run the full suite**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads
```
Expected: ≥329 tests passing.

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
Expected: format may rewrite a few lines (commit them); lint shows only pre-existing `noNonNullAssertion` warnings and **0 errors**.

If format made changes, commit them:
```bash
cd /Users/lxz/ws/personal/carbonbook
git diff --stat
git add -A
git commit -m "chore: biome format pass for freight stage"
```

(If `git diff --stat` shows no changes, skip the commit.)

---

## Closeout

Sub-project 2 of 5 (freight.v1) lands on `main` with no tag — the `phase-1d` tag is reserved for after all 4 stages + EF Matcher land.

Expected end state:
- ≥329 vitest tests passing
- 3 stages registered (`china_utility.v1`, `fuel_receipt.v1`, `freight.v1`)
- Upload stage dropdown auto-grows to 3 options (zero UI code change — driven by `stages:list`)
- ExtractionReview renders per-stage fields for all 3 stages
- ExtractionReview is at ~520 LOC; per-stage component split DEFERRED to Phase 1.5 prep work (after travel.v1 lands at 4 stages, refactor before EF Matcher)

Manual smoke is DEFERRED to the consolidated pre-tag verification — does not run after each sub-project. The phase-1d tag-time smoke covers all 4 freight modes + all 5 stages end-to-end.

Next sub-project (3 of 5): `purchase.v1`. Same brainstorm → spec → plan → execute cycle.
