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
    .describe('Total freight charges in CNY (元 / 应付运费 / 总费用). 0 if not legible.'),
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
