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
 * v1 Chinese-travel stage. Mirrors `freightStage` / `purchaseStage`
 * structure: one schema, one text-path prompt, one vision-path prompt,
 * both sharing a private FIELD_RULES const.
 *
 * Prompt body lands in Task 2; this stub exists so the registry wiring
 * + metadata tests can pass first.
 */
export const travelStage: Stage<TravelExtraction> = {
  id: 'travel.v1',
  version: '1.0.0',
  description: 'Chinese travel receipt (差旅票据) — classify + extract',
  inputType: 'pdf_text',
  schema: travelExtraction,
  buildPrompt: (_pdfText: string) => '__PROMPT_PENDING_TASK_2__',
  buildVisionMessages: (): VisionMessages => ({
    userText: '__VISION_PROMPT_PENDING_TASK_2__',
  }),
};
