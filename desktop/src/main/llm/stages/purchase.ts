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
items (different SKUs on one invoice). When that happens, aggregate
(AGGREGATE) them into a single row:
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
