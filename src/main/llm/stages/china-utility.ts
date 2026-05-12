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
You are extracting structured data from a Chinese electricity utility bill (中国电费单).

Bill text (extracted from PDF):
<bill>
${pdfText}
</bill>

Output rules (CRITICAL — DeepSeek and other providers without native JSON
schema mode read these directly):
- Return EXACTLY ONE JSON object, no markdown, no \`\`\`json fences, no prose.
- Every required field must be present. Numeric fields are numbers (not
  strings). Date fields are strings in ISO format "YYYY-MM-DD".
- If a value is genuinely missing on the bill, use null ONLY for the
  fields explicitly marked nullable (account_no, amount_yuan). Never omit
  a key. Never use null for required fields — emit a best-guess instead
  with confidence='low'.

Field mapping (Chinese bills follow regional variations):
- doc_type: always "china_utility" — even if the bill looks unusual,
  the user already classified it; you're confirming + extracting.
- supplier_name: the issuing utility, e.g. "国网北京市电力公司",
  "南方电网XX供电局". Take the most specific company name visible.
- account_no: "户号" / "用户编号" / "客户编号". null if not shown.
- amount_kwh: numeric kWh consumption.
  - "用电量" / "电量" / "实用电量" → kWh value
  - If shown as "度", that IS kWh (1 度 = 1 kWh)
  - If shown as "万度", multiply by 10000
- amount_yuan: total billed amount in CNY.
  - "应收合计" / "本月电费" / "实收金额" / "总金额"
  - Number only (no "¥" / "元"). null if absent.
- period_start / period_end:
  - "计费起止" / "用电期间" / "抄表日期" gives the range.
  - "上次抄表日期" → period_start, "本次抄表日期" → period_end.
  - Format as ISO YYYY-MM-DD. If only year-month shown ("2025-09"),
    assume first/last day of month.
- confidence:
  - "high" if supplier_name, amount_kwh, period_start, period_end are
    all clearly visible and unambiguous.
  - "medium" if one of those was inferred or partially obscured.
  - "low" if the document doesn't look like a Chinese utility bill at
    all, or multiple required fields are guesses.

Example valid response shape (do not copy the values — extract from the
real bill above):
{"doc_type":"china_utility","supplier_name":"国网北京市电力公司","account_no":"1234567890","amount_kwh":523.5,"amount_yuan":312.7,"period_start":"2025-09-01","period_end":"2025-09-30","confidence":"high"}`,
};
