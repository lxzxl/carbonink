import { z } from 'zod';
import type { Stage, VisionMessages } from './types.js';

/**
 * Transit mode discriminator. 3 transit modes covered in v1; hotel /
 * lodging is intentionally EXCLUDED — different unit family
 * (room-nights vs passenger-km / vehicle-km) and different EF lookup
 * pattern. Lodging becomes `lodging.v1` in Phase 1.5.
 *
 * Mapping intent (model gets this verbatim in the prompt):
 *   - 机票 / e-ticket / airline / itinerary → 'air'
 *   - 高铁 / 动车 / 普通火车 → 'rail'
 *   - 出租车 / 网约车 / 打车 / 滴滴 → 'taxi'
 */
export const travelMode = z.enum(['air', 'rail', 'taxi']);
export type TravelMode = z.infer<typeof travelMode>;

/**
 * Structured output schema for a Chinese business-travel receipt
 * (机票 / 高铁票 / 打车票).
 *
 * Shape strict, values permissive — same contract as the prior 4 stages.
 * Numeric fields use `.min(0)`. **7 fields are nullable** because the
 * 3 transit modes use wildly different field sets:
 *   - passenger_name: air/rail print it for ID verification, taxi often doesn't
 *   - arrival_at: air/rail print it, taxi usually doesn't
 *   - travel_class: cabin (air) / seat class (rail), null for taxi
 *   - distance_km: taxi often prints it ("行驶里程"), air/rail almost never
 *   - flight_or_train_no: CA1234 (air) / G102 (rail), null for taxi
 *   - vehicle_plate: taxi only
 *   - ticket_no: any reference number (e-ticket, boarding ref, order id)
 *
 * The mode discriminator + 7 nullable subtype fields mirror freight's
 * `mode` + `vehicle_class` + `distance_km` + `tracking_no` pattern.
 * Forcing per-mode shape would require 3 separate stages — explicitly
 * rejected in spec §1 because it explodes registry/i18n/test maintenance
 * by 3x for marginal type-safety benefit.
 *
 * `distance_km` is nullable BY DESIGN — the LLM is forbidden from
 * estimating it from origin/destination airport/station strings (see
 * prompt). The EF Matcher (Phase 1.5) fills distance from a routing API
 * when the receipt didn't show it.
 */
export const travelExtraction = z.object({
  doc_type: z.literal('travel').describe('Always the literal "travel".'),
  supplier_name: z
    .string()
    .describe(
      'Carrier / operator name. Air: airline (e.g. "中国国际航空", "China Eastern"). ' +
        'Rail: "中国铁路" or specific railway bureau. Taxi: ride-hail platform ' +
        '("滴滴出行", "高德打车") or taxi company. Empty string if not legible.',
    ),
  mode: travelMode.describe(
    'Transit mode discriminator. air = airline; rail = high-speed rail / 动车 / ' +
      'sleeper; taxi = ride-hail / metered taxi / 网约车.',
  ),
  passenger_name: z
    .string()
    .nullable()
    .describe(
      'Passenger name printed on the ticket (air/rail show this for ID verification; ' +
        'taxi receipts usually do not). Used for audit / employee reconciliation. ' +
        'null if absent.',
    ),
  origin: z
    .string()
    .describe(
      'Departure location. Air: airport name or IATA code ("北京首都国际机场" or "PEK"). ' +
        'Rail: station name ("上海虹桥站"). Taxi: free-form starting address. Empty ' +
        'string if not legible.',
    ),
  destination: z
    .string()
    .describe('Arrival location, same format as origin. Empty string if not legible.'),
  departure_at: z
    .string()
    .describe(
      'Departure date+time as ISO "YYYY-MM-DDTHH:MM" if both are printed; just ' +
        '"YYYY-MM-DD" if only the date is shown. Empty string if not legible.',
    ),
  arrival_at: z
    .string()
    .nullable()
    .describe(
      'Arrival datetime in same ISO format. Air/rail usually print this; taxi ' +
        'receipts often do not. null if absent.',
    ),
  travel_class: z
    .string()
    .nullable()
    .describe(
      'Free-text class / cabin / seat type as printed on the ticket. Air: ' +
        '"经济舱" / "Y" / "商务舱" / "C" / "头等舱" / "F". Rail: "二等座" / "一等座" / ' +
        '"商务座" / "硬卧" / "软卧". Taxi: null (no class concept). null if absent.',
    ),
  distance_km: z
    .number()
    .min(0)
    .nullable()
    .describe(
      'Trip distance in kilometers. Air/rail tickets almost never print distance — ' +
        'leave null. Taxi receipts often print km ("行驶里程: 8.3 公里"); fill from ' +
        'the receipt. Do NOT estimate from origin/destination strings — EF Matcher ' +
        '(Phase 1.5) fills via routing API.',
    ),
  flight_or_train_no: z
    .string()
    .nullable()
    .describe(
      'Air: flight number ("CA1234"). Rail: train number ("G102", "D305", "Z123"). ' +
        'Taxi: null. null if absent.',
    ),
  vehicle_plate: z
    .string()
    .nullable()
    .describe('Taxi only: vehicle license plate ("沪A12345"). Air/rail: null. null if absent.'),
  amount_yuan: z
    .number()
    .min(0)
    .describe(
      'Total amount paid in CNY ("票面价" / "总价" / "实付"). For air, this includes ' +
        'base fare + fuel surcharge + airport tax. Number only. 0 if not legible.',
    ),
  ticket_no: z
    .string()
    .nullable()
    .describe(
      'Booking reference / 电子客票号 / 取票号 / order id. Air: 13-digit e-ticket ' +
        'number. Rail: 取票号 (alphanumeric). Taxi: order id from the app. null if absent.',
    ),
  confidence: z
    .enum(['high', 'medium', 'low'])
    .describe(
      'high: supplier_name + mode + origin + destination + departure_at + amount_yuan ' +
        'all clearly visible. medium: 1-2 fields inferred, OR round-trip ticket ' +
        '(only outbound leg captured), OR multi-modal trip. low: not a travel ' +
        'receipt, OR multiple required fields are guesses, OR mode is ambiguous.',
    ),
});

export type TravelExtraction = z.infer<typeof travelExtraction>;

/**
 * Field-mapping + output-format rules shared between `buildPrompt`
 * (text path) and `buildVisionMessages` (image path). Extracting this
 * to a const guarantees the two paths stay aligned. Same DRY pattern as
 * china_utility.v1, fuel_receipt.v1, freight.v1, and purchase.v1.
 */
const FIELD_RULES = `Output rules (CRITICAL — DeepSeek and other providers without native JSON
schema mode read these directly):
- Return EXACTLY ONE JSON object, no markdown, no \`\`\`json fences, no prose.
- Every required field must be present. Numeric fields are numbers (not
  strings). Date / datetime fields are strings in ISO format
  "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM".
- If a value is genuinely missing on the ticket, use null ONLY for the
  seven fields explicitly marked nullable (passenger_name, arrival_at,
  travel_class, distance_km, flight_or_train_no, vehicle_plate,
  ticket_no). Never omit a key. Never use null for required fields —
  emit a best-guess instead with confidence='low'.

Mode classification (CRITICAL — this drives EF lookup):
- air:   anything from an airline (机票 / e-ticket / itinerary /
         登机牌 / 行程单 / boarding pass / airline receipt).
         Examples: 国航 CA1234 北京→上海, 海航, 东方航空.
- rail:  高铁 (G-prefix), 动车 (D-prefix), 普通火车 (Z/T/K-prefix),
         sleeper. 12306 / 中国铁路 source.
         Examples: G102 上海虹桥 → 北京南, D305, K123.
- taxi:  metered taxi / ride-hail / 网约车 / 打车. Includes 滴滴出行,
         高德打车, 出租车票, traditional 出租车发票.
         If multi-modal (e.g. 机场专线大巴 mixing airport bus + city
         taxi), pick the dominant leg + set confidence='medium'.

Per-mode field expectations:
- air:
  - passenger_name: usually printed (ID verification required).
  - origin/destination: airport name or IATA code.
  - departure_at: full ISO datetime.
  - arrival_at: full ISO datetime (usually printed).
  - travel_class: "经济舱" / "Y" / "商务舱" / "C" / "头等舱" / "F".
  - distance_km: usually null (rarely on tickets).
  - flight_or_train_no: "CA1234" format (2-letter airline code + digits).
  - vehicle_plate: null.
  - ticket_no: 13-digit e-ticket number / 电子客票号.
- rail:
  - passenger_name: usually printed.
  - origin/destination: station name ("上海虹桥站", "北京南站").
  - departure_at: full ISO datetime.
  - arrival_at: usually printed but not always.
  - travel_class: "二等座" / "一等座" / "商务座" / "硬卧" / "软卧".
  - distance_km: usually null.
  - flight_or_train_no: "G102" / "D305" / "Z123" / "K456" / "C112".
  - vehicle_plate: null.
  - ticket_no: 取票号 (alphanumeric, e.g. "E123456789").
- taxi:
  - passenger_name: usually null.
  - origin/destination: free-form address strings.
  - departure_at: date or datetime.
  - arrival_at: usually null.
  - travel_class: null.
  - distance_km: usually present ("行驶里程: 8.3 公里"); fill it.
  - flight_or_train_no: null.
  - vehicle_plate: "沪A12345" format.
  - ticket_no: order id from the app.

distance_km rule (CRITICAL): only fill if an EXPLICIT number appears
on the receipt. Do NOT estimate from origin/destination strings.
Air/rail almost never print distance — leave null. Wrong example:
"Beijing → Shanghai → distance_km: 1200" is WRONG when no km appeared
on the ticket. EF Matcher (Phase 1.5) fills distance from a routing
API at Confirm time.

Round-trip tickets (common on air e-tickets): if the PDF shows BOTH
outbound and return legs, extract the OUTBOUND leg as the primary
record and set confidence='medium'. The return leg becomes a separate
extraction in a future v2.

amount_yuan: total CNY paid. For air, this includes base fare + fuel
surcharge ("燃油附加费") + airport tax ("机场建设费"). Aggregate to
one number — do NOT extract each line separately.

confidence:
- "high": supplier, mode, origin, destination, departure_at, amount_yuan
  all clearly visible and unambiguous, single-leg trip.
- "medium": 1-2 fields inferred, OR round-trip ticket (only outbound
  captured), OR multi-modal trip, OR mode inferred from supplier.
- "low": not a travel receipt, OR multiple required fields are guesses,
  OR mode is ambiguous.

Ignore (DO NOT include in the output): fee breakdown (燃油附加费 /
机场建设费 separately — aggregate into amount_yuan), seat number,
gate / 登机口, booking agent name, frequent-flyer / 里程卡 number,
refund / cancellation info, receipt-level discounts / coupons, ID
numbers (passport / 身份证号).

Example valid response shapes (do not copy values — extract from the
real ticket; one example per mode for shape reference):

Air:
{"doc_type":"travel","supplier_name":"中国国际航空","mode":"air","passenger_name":"张三","origin":"北京首都国际机场","destination":"上海虹桥国际机场","departure_at":"2026-04-15T08:30","arrival_at":"2026-04-15T10:50","travel_class":"经济舱","distance_km":null,"flight_or_train_no":"CA1234","vehicle_plate":null,"amount_yuan":1250,"ticket_no":"7841234567890","confidence":"high"}

Rail:
{"doc_type":"travel","supplier_name":"中国铁路","mode":"rail","passenger_name":"李四","origin":"上海虹桥站","destination":"北京南站","departure_at":"2026-04-22T14:30","arrival_at":"2026-04-22T20:15","travel_class":"二等座","distance_km":null,"flight_or_train_no":"G102","vehicle_plate":null,"amount_yuan":553,"ticket_no":"E123456789","confidence":"high"}

Taxi:
{"doc_type":"travel","supplier_name":"滴滴出行","mode":"taxi","passenger_name":null,"origin":"浦东国际机场","destination":"上海市浦东新区","departure_at":"2026-04-15T11:30","arrival_at":null,"travel_class":null,"distance_km":42.5,"flight_or_train_no":null,"vehicle_plate":"沪A12345","amount_yuan":180,"ticket_no":"DD20260415123","confidence":"high"}`;

/**
 * v1 Chinese-travel stage. Mirrors `freightStage` / `purchaseStage`:
 * - same Stage<T> shape;
 * - text path uses <ticket>${pdfText}</ticket> wrapper (the noun
 *   matches the document type; prior stages used <bill> for utility,
 *   <receipt> for fuel + freight, <invoice> for purchase);
 * - vision path swaps the wrapper for an "images attached" hint and
 *   reuses FIELD_RULES verbatim;
 * - prompt is in English (instruction-following) while the ticket
 *   content stays Chinese.
 */
export const travelStage: Stage<TravelExtraction> = {
  id: 'travel.v1',
  version: '1.0.0',
  description: 'Chinese travel receipt (差旅票据) — classify + extract',
  inputType: 'pdf_text',
  schema: travelExtraction,
  buildPrompt: (pdfText: string) => `
You are extracting structured data from a Chinese business-travel receipt (差旅票据): airline e-ticket (机票), high-speed rail ticket (高铁票), or taxi/ride-hail receipt (打车票).

Ticket text (extracted from PDF):
<ticket>
${pdfText}
</ticket>

${FIELD_RULES}`,
  buildVisionMessages: (): VisionMessages => ({
    userText: `You are extracting structured data from a Chinese business-travel receipt (差旅票据): airline e-ticket (机票), high-speed rail ticket (高铁票), or taxi/ride-hail receipt (打车票).

The ticket is provided as one or more PNG images (one per PDF page) attached to this
message. Look at the images directly — do NOT request OCR text from another tool.

If the PDF shows multiple tickets batched together (e.g. round-trip e-ticket with both
outbound and return legs), extract the OUTBOUND / most prominent one and set
confidence='medium'.

${FIELD_RULES}`,
  }),
};
