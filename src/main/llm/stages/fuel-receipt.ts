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
