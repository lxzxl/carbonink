import { z } from 'zod';
import type { Stage, VisionMessages } from './types.js';

/**
 * Coarse fuel-category bucket driving downstream emission-factor lookup.
 * The 8 buckets cover every fuel type carbonink needs to account for at
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
  doc_type: z.literal('fuel_receipt').describe('Always the literal "fuel_receipt".'),
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
      'Per-liter price in CNY (元/升). null if not shown — some pre-paid ' + 'receipts hide it.',
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
