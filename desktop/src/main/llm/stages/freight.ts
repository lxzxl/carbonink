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
