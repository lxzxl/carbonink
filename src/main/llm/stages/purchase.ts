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
