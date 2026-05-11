import { z } from 'zod';
import type { Stage } from './types.js';

/**
 * Structured output schema for a Chinese electricity utility bill. The model
 * is instructed to populate every field; nullable fields exist for items
 * commonly missing (account number, total in CNY). Date fields are
 * ISO-validated so downstream consumers (the activity_data builder) can
 * parse them without re-validating.
 *
 * The `.describe()` strings are picked up by AI SDK's `generateObject` and
 * forwarded into the JSON schema sent to the model — they double as inline
 * documentation for both humans and the LLM.
 */
export const chinaUtilityExtraction = z.object({
  doc_type: z
    .literal('china_utility')
    .describe(
      'Must be the literal "china_utility" if confident this is a Chinese electricity bill',
    ),
  supplier_name: z.string().describe('国网XX供电公司 or similar'),
  account_no: z.string().nullable().describe('User account number, if visible'),
  amount_kwh: z.number().positive().describe('Energy consumption in kWh (degrees, 度)'),
  amount_yuan: z.number().positive().nullable().describe('Total bill amount in CNY, if visible'),
  period_start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe('Billing period start date (ISO YYYY-MM-DD)'),
  period_end: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe('Billing period end date (ISO YYYY-MM-DD)'),
  confidence: z
    .enum(['high', 'medium', 'low'])
    .describe(
      'Your confidence in the extraction (medium if any field unclear; low if document looks unfamiliar)',
    ),
});

export type ChinaUtilityExtraction = z.infer<typeof chinaUtilityExtraction>;

/**
 * v1 China utility stage. Combines classification ("is this a Chinese
 * electricity bill?") and extraction in a single prompt — at Phase 1b
 * volume the cost of two round-trips isn't worth the cleanliness, and the
 * `confidence` enum gives us a soft fallback when the doc looks unfamiliar.
 *
 * Prompt is in English (model performs better at instruction-following in
 * English) while the bill text itself stays Chinese inside the `---` block.
 */
export const chinaUtilityStage: Stage<ChinaUtilityExtraction> = {
  id: 'china_utility.v1',
  version: '1.0.0',
  description: 'Chinese electricity bill (国网/南方电网 风格) — classify + extract',
  inputType: 'pdf_text',
  schema: chinaUtilityExtraction,
  buildPrompt: (pdfText) => `
You are extracting data from a Chinese electricity utility bill (中国电费单).

Text content from the PDF:
---
${pdfText}
---

Instructions:
- If this is NOT a Chinese electricity bill, return doc_type with confidence='low' but still attempt fields.
- "用电量" / "kWh" / "度" → amount_kwh
- "应收合计" / "电费" / "总金额" → amount_yuan (CNY)
- "抄表日期" / "计费起止" → period_start / period_end (parse to ISO YYYY-MM-DD)
- Common suppliers: 国家电网, 南方电网, etc.
- confidence='high' only if supplier_name, amount_kwh, period_start, period_end are all clearly visible and unambiguous.

Return the structured object directly.`,
};
