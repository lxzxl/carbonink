# `travel.v1` Stage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the fifth and final transit extraction stage for Phase 1. Users upload a Chinese business-travel receipt (机票 / 高铁票 / 打车票), the AI extracts mode / endpoints / datetime / class / amount / reference numbers, the existing Confirm → ActivityForm → activity_data flow runs end-to-end.

**Architecture:** Single `Stage<TravelExtraction>` with a `mode: enum(['air','rail','taxi'])` discriminator + 7 nullable mode-specific fields (passenger_name, arrival_at, travel_class, distance_km, flight_or_train_no, vehicle_plate, ticket_no). Mirrors freight's mode-discriminator pattern at slightly higher field count. Hotel/lodging is EXCLUDED from v1 — different unit family, future `lodging.v1` in Phase 1.5.

**Tech Stack:** TypeScript, AI SDK 6, zod, React 18, TanStack Router/Query, vitest, biome, paraglide i18n.

**Spec:** `docs/specs/2026-05-13-travel-stage-design.md` (commit `9048a01`).

**Reference plan + shipped work:** `docs/plans/2026-05-13-carbonbook-purchase-stage.md` (commit `265b3f0`) — this plan mirrors its task ordering. Differences are domain-specific (15-field schema, 3-mode enum, dual-track ActivityForm prefill per mode) and the ExtractionReview switch becomes 5-arm. The prompt wrapper is `<ticket>` (matching the document type).

⚠️ **LAST sub-project before the per-stage component split refactor.** After travel.v1 lands on main, the IMMEDIATE next sub-project (Phase 1.5 prep) is the ExtractionReview file split — DO NOT do that refactor inside this sub-project. Same single-file constraint as the prior 3 stages.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/main/llm/stages/travel.ts` | **create** | `travelMode` zod enum (3 values: air/rail/taxi), `travelExtraction` zod object schema (15 fields), `TravelExtraction` inferred type, `TravelMode` inferred type, `travelStage: Stage<TravelExtraction>` with `id='travel.v1'`, `buildPrompt` (text path) + `buildVisionMessages` (vision path) sharing a private `FIELD_RULES` constant. |
| `src/main/llm/stages/registry.ts` | modify | Add `travelStage` to the `_stageRegistry` Map (5th entry). |
| `tests/main/llm/stages/travel.test.ts` | **create** | Mirror `purchase.test.ts`: schema accept/reject boundaries (~16 tests — extra because each of the 3 modes gets its own happy-path object), stage metadata + prompt-content checks, registry integration. |
| `tests/main/llm/stages/registry.test.ts` | modify | Bump expected stage count 4 → 5 + add `travel.v1` to id-set assertions. |
| `messages/en.json`, `messages/zh-CN.json` | modify | 7 new keys (passenger_name, departure_at, arrival_at, travel_class, flight_or_train_no, vehicle_plate, ticket_no). REUSES `mode` / `origin` / `destination` / `distance_km` keys added by freight. |
| `src/renderer/components/ExtractionReview.tsx` | modify | Add `TravelParsed` type, `TravelFields` subcomponent (12-13 rows), `buildTravelInitialValues` builder (dual-track per mode: `passenger-km` vs `vehicle-km`), 5th arm in 2 ternaries. **NO file refactor — that's the next sub-project (Phase 1.5 prep).** File lands at ~720 LOC; intentional. |
| `tests/main/services/extraction-service.test.ts` | modify | One new smoke test mirroring fuel + freight + purchase smokes — verifies stage_id routing + schema reachability. |

---

## Task 1: `travel.ts` schema + types

**Files:**
- Create: `src/main/llm/stages/travel.ts`
- Test: `tests/main/llm/stages/travel.test.ts`

This task lands the schema + an empty stage shell. Prompt content arrives in Task 2.

- [ ] **Step 1: Write the failing schema tests**

Create `tests/main/llm/stages/travel.test.ts`:

```ts
import {
  type TravelExtraction,
  travelExtraction,
  travelStage,
} from '@main/llm/stages/travel';
import { describe, expect, it } from 'vitest';

const AIR_GOOD: TravelExtraction = {
  doc_type: 'travel',
  supplier_name: '中国国际航空',
  mode: 'air',
  passenger_name: '张三',
  origin: '北京首都国际机场',
  destination: '上海虹桥国际机场',
  departure_at: '2026-04-15T08:30',
  arrival_at: '2026-04-15T10:50',
  travel_class: '经济舱',
  distance_km: null,
  flight_or_train_no: 'CA1234',
  vehicle_plate: null,
  amount_yuan: 1250,
  ticket_no: '7841234567890',
  confidence: 'high',
};

const RAIL_GOOD: TravelExtraction = {
  doc_type: 'travel',
  supplier_name: '中国铁路',
  mode: 'rail',
  passenger_name: '李四',
  origin: '上海虹桥站',
  destination: '北京南站',
  departure_at: '2026-04-22T14:30',
  arrival_at: '2026-04-22T20:15',
  travel_class: '二等座',
  distance_km: null,
  flight_or_train_no: 'G102',
  vehicle_plate: null,
  amount_yuan: 553,
  ticket_no: 'E123456789',
  confidence: 'high',
};

const TAXI_GOOD: TravelExtraction = {
  doc_type: 'travel',
  supplier_name: '滴滴出行',
  mode: 'taxi',
  passenger_name: null,
  origin: '浦东国际机场',
  destination: '上海市浦东新区',
  departure_at: '2026-04-15T11:30',
  arrival_at: null,
  travel_class: null,
  distance_km: 42.5,
  flight_or_train_no: null,
  vehicle_plate: '沪A12345',
  amount_yuan: 180,
  ticket_no: 'DD20260415123',
  confidence: 'high',
};

describe('travelExtraction schema', () => {
  it('accepts a fully populated air-mode travel JSON', () => {
    expect(travelExtraction.parse(AIR_GOOD)).toEqual(AIR_GOOD);
  });

  it('accepts a fully populated rail-mode travel JSON', () => {
    expect(travelExtraction.parse(RAIL_GOOD)).toEqual(RAIL_GOOD);
  });

  it('accepts a fully populated taxi-mode travel JSON', () => {
    expect(travelExtraction.parse(TAXI_GOOD)).toEqual(TAXI_GOOD);
  });

  it('accepts the 7 nullable fields set to null', () => {
    const parsed = travelExtraction.parse({
      ...AIR_GOOD,
      passenger_name: null,
      arrival_at: null,
      travel_class: null,
      distance_km: null,
      flight_or_train_no: null,
      vehicle_plate: null,
      ticket_no: null,
    });
    expect(parsed.passenger_name).toBeNull();
    expect(parsed.arrival_at).toBeNull();
    expect(parsed.travel_class).toBeNull();
    expect(parsed.distance_km).toBeNull();
    expect(parsed.flight_or_train_no).toBeNull();
    expect(parsed.vehicle_plate).toBeNull();
    expect(parsed.ticket_no).toBeNull();
  });

  it('accepts permissive zero values for amount_yuan and distance_km', () => {
    expect(() => travelExtraction.parse({ ...AIR_GOOD, amount_yuan: 0 })).not.toThrow();
    expect(() => travelExtraction.parse({ ...TAXI_GOOD, distance_km: 0 })).not.toThrow();
  });

  it('accepts empty origin / destination / departure_at strings (permissive)', () => {
    expect(() => travelExtraction.parse({ ...AIR_GOOD, origin: '' })).not.toThrow();
    expect(() => travelExtraction.parse({ ...AIR_GOOD, destination: '' })).not.toThrow();
    expect(() => travelExtraction.parse({ ...AIR_GOOD, departure_at: '' })).not.toThrow();
  });

  it('accepts non-ISO departure_at / arrival_at strings (permissive)', () => {
    expect(() =>
      travelExtraction.parse({ ...AIR_GOOD, departure_at: '2026/04/15 08:30' }),
    ).not.toThrow();
    expect(() =>
      travelExtraction.parse({ ...AIR_GOOD, arrival_at: '2026/04/15 10:50' }),
    ).not.toThrow();
  });

  it('rejects negative amount_yuan', () => {
    expect(() => travelExtraction.parse({ ...AIR_GOOD, amount_yuan: -1 })).toThrow();
  });

  it('rejects negative distance_km', () => {
    expect(() => travelExtraction.parse({ ...TAXI_GOOD, distance_km: -5 })).toThrow();
  });

  it('rejects an unknown mode value', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
      travelExtraction.parse({ ...AIR_GOOD, mode: 'ship' } as any),
    ).toThrow();
  });

  it('accepts each of the 3 valid mode values', () => {
    for (const mode of ['air', 'rail', 'taxi'] as const) {
      expect(() => travelExtraction.parse({ ...AIR_GOOD, mode })).not.toThrow();
    }
  });

  it('rejects an unknown confidence value', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
      travelExtraction.parse({ ...AIR_GOOD, confidence: 'guess' } as any),
    ).toThrow();
  });

  it('rejects a doc_type other than the literal "travel"', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid runtime input
      travelExtraction.parse({ ...AIR_GOOD, doc_type: 'purchase' } as any),
    ).toThrow();
  });
});

describe('travelStage metadata', () => {
  it('exposes id="travel.v1", version, inputType, and prompt builders', () => {
    expect(travelStage.id).toBe('travel.v1');
    expect(travelStage.version).toBe('1.0.0');
    expect(travelStage.inputType).toBe('pdf_text');
    expect(typeof travelStage.buildPrompt).toBe('function');
    expect(typeof travelStage.buildVisionMessages).toBe('function');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/llm/stages/travel.test.ts --pool=threads
```
Expected: FAIL with "Cannot find module '@main/llm/stages/travel'".

- [ ] **Step 3: Create the schema-only module**

Create `src/main/llm/stages/travel.ts`:

```ts
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
    .describe(
      'Taxi only: vehicle license plate ("沪A12345"). Air/rail: null. null if absent.',
    ),
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/llm/stages/travel.test.ts --pool=threads
pnpm typecheck
```
Expected: 16 tests passing (15 schema + 1 metadata). typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/main/llm/stages/travel.ts tests/main/llm/stages/travel.test.ts
git commit -m "feat(stages): travel.v1 — schema + stage shell"
```

---

## Task 2: `travel.ts` prompts (text + vision)

**Files:**
- Modify: `src/main/llm/stages/travel.ts`
- Test: `tests/main/llm/stages/travel.test.ts`

- [ ] **Step 1: Add prompt-content assertions to the metadata test**

Open `tests/main/llm/stages/travel.test.ts`. Replace the existing single `it('exposes id="travel.v1"...')` test inside `describe('travelStage metadata', ...)` with these three assertions:

```ts
describe('travelStage metadata', () => {
  it('exposes id="travel.v1", version, inputType, and prompt builders', () => {
    expect(travelStage.id).toBe('travel.v1');
    expect(travelStage.version).toBe('1.0.0');
    expect(travelStage.inputType).toBe('pdf_text');
    expect(typeof travelStage.buildPrompt).toBe('function');
    expect(typeof travelStage.buildVisionMessages).toBe('function');
  });

  it('buildPrompt embeds the PDF text inside <ticket>...</ticket> AND includes field rules', () => {
    const prompt = travelStage.buildPrompt('SAMPLE_TRAVEL_TEXT_TOKEN');
    expect(prompt).toContain('Chinese business-travel');
    expect(prompt).toContain('SAMPLE_TRAVEL_TEXT_TOKEN');
    expect(prompt).toContain('<ticket>');
    expect(prompt).toContain('</ticket>');
    // Field rules verbatim shared with vision path.
    expect(prompt).toContain('mode');
    expect(prompt).toContain('distance_km');
    // Each of the 3 mode enum values appears in the prompt body.
    expect(prompt).toContain('air');
    expect(prompt).toContain('rail');
    expect(prompt).toContain('taxi');
    // The "do not estimate distance" guidance is verbatim.
    expect(prompt).toContain('Do NOT estimate');
  });

  it('buildVisionMessages mirrors buildPrompt field rules but omits the <ticket> placeholder', () => {
    const msgs = travelStage.buildVisionMessages?.();
    expect(msgs).toBeDefined();
    expect(msgs?.userText).toContain('Chinese business-travel');
    expect(msgs?.userText).toContain('mode');
    expect(msgs?.userText).toContain('distance_km');
    expect(msgs?.userText).toContain('Do NOT estimate');
    // No PDF text placeholder — image content is appended by the caller.
    expect(msgs?.userText).not.toContain('<ticket>');
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/llm/stages/travel.test.ts --pool=threads
```
Expected: 15 schema tests still pass; 2 of the 3 metadata tests fail (the prompt-content assertions).

- [ ] **Step 3: Replace the stub prompts with the real ones**

In `src/main/llm/stages/travel.ts`, replace the entire `travelStage` export at the bottom (everything from the JSDoc comment above `export const travelStage` onward) with:

```ts
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
```

- [ ] **Step 4: Run all tests to confirm green**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/llm/stages/travel.test.ts --pool=threads
pnpm typecheck
```
Expected: 18 tests passing (15 schema + 3 metadata). typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/main/llm/stages/travel.ts tests/main/llm/stages/travel.test.ts
git commit -m "feat(stages): travel.v1 — text + vision prompts with shared FIELD_RULES"
```

---

## Task 3: Register `travelStage`

**Files:**
- Modify: `src/main/llm/stages/registry.ts`
- Modify: `tests/main/llm/stages/registry.test.ts`
- Test: append to `tests/main/llm/stages/travel.test.ts`

- [ ] **Step 1: Add a registration test**

Open `tests/main/llm/stages/travel.test.ts`. Append at the end of the file:

```ts
describe('travelStage registry integration', () => {
  it('is returned by getStage("travel.v1")', () => {
    expect(getStage('travel.v1')).toBe(travelStage);
  });

  it('appears in listStages() alongside the existing 4 stages', () => {
    const ids = listStages().map((s) => s.id);
    expect(ids).toContain('travel.v1');
    expect(ids).toContain('purchase.v1');
    expect(ids).toContain('freight.v1');
    expect(ids).toContain('fuel_receipt.v1');
    expect(ids).toContain('china_utility.v1');
  });
});
```

Hoist the `import { getStage, listStages } from '@main/llm/stages/registry'` import up to the file's top import block.

- [ ] **Step 2: Update the existing registry test to expect 5 stages**

Open `tests/main/llm/stages/registry.test.ts`. Read the existing assertions — after purchase landed they expect 4 stages. Update each:

1. Any `stageRegistry.size === 4` or `listStages().length === 4` assertion → `=== 5`.
2. Any id-set assertion including the existing 4 ids → also include `'travel.v1'`.
3. Test names mentioning "4 stages" → update to "5 stages" / "all registered stages".

**DO NOT add a `travelStage` import to registry.test.ts unless one of the new assertions actually uses the reference directly.** Just add `'travel.v1'` to the string-based id-set assertions. (The prior freight/purchase tasks ran into a lint error from unused imports.)

- [ ] **Step 3: Run tests to verify the new ones fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/llm/stages/travel.test.ts tests/main/llm/stages/registry.test.ts --pool=threads
```
Expected: 18 prior travel tests still pass; 2 new registry-integration tests fail. registry.test.ts updates from Step 2 also fail until Step 4.

- [ ] **Step 4: Add the registry entry**

Open `src/main/llm/stages/registry.ts`. Current state (after purchase landed):
```ts
import { chinaUtilityStage } from './china-utility.js';
import { freightStage } from './freight.js';
import { fuelReceiptStage } from './fuel-receipt.js';
import { purchaseStage } from './purchase.js';
import type { Stage } from './types.js';

const _stageRegistry = new Map<string, Stage>([
  [chinaUtilityStage.id, chinaUtilityStage as Stage],
  [fuelReceiptStage.id, fuelReceiptStage as Stage],
  [freightStage.id, freightStage as Stage],
  [purchaseStage.id, purchaseStage as Stage],
]);
```

Replace ONLY the imports + Map literal with:
```ts
import { chinaUtilityStage } from './china-utility.js';
import { freightStage } from './freight.js';
import { fuelReceiptStage } from './fuel-receipt.js';
import { purchaseStage } from './purchase.js';
import { travelStage } from './travel.js';
import type { Stage } from './types.js';

const _stageRegistry = new Map<string, Stage>([
  [chinaUtilityStage.id, chinaUtilityStage as Stage],
  [fuelReceiptStage.id, fuelReceiptStage as Stage],
  [freightStage.id, freightStage as Stage],
  [purchaseStage.id, purchaseStage as Stage],
  [travelStage.id, travelStage as Stage],
]);
```

Leave the rest of the file UNCHANGED.

- [ ] **Step 5: Run all tests to confirm green**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads
pnpm typecheck
```
Expected: 364 tests passing (362 from prior + 2 new). typecheck clean.

**If vitest reports many failures with "NODE_MODULE_VERSION 145" errors**: better-sqlite3 ABI mismatch (environmental, not a regression). Recovery:
```bash
rm -f node_modules/.pnpm/better-sqlite3@12.9.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node \
      node_modules/.pnpm/better-sqlite3@12.9.0/node_modules/better-sqlite3/build/Release/.forge-meta
pnpm rebuild better-sqlite3
```

- [ ] **Step 6: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/main/llm/stages/registry.ts \
        tests/main/llm/stages/travel.test.ts \
        tests/main/llm/stages/registry.test.ts
git commit -m "feat(stages): register travel.v1 in stage registry"
```

---

## Task 4: i18n strings

**Files:**
- Modify: `messages/en.json`
- Modify: `messages/zh-CN.json`

Add 7 new keys. Reused from prior stages (no need to add): `mode` / `origin` / `destination` / `distance_km` (all from freight); `supplier` / `amount_yuan` / `occurred_at` / `confidence` (from earlier).

- [ ] **Step 1: Validate JSON is well-formed before edits**

```bash
cd /Users/lxz/ws/personal/carbonbook
node -e "JSON.parse(require('fs').readFileSync('messages/en.json', 'utf8')); JSON.parse(require('fs').readFileSync('messages/zh-CN.json', 'utf8')); console.log('OK');"
```
Expected: `OK`.

- [ ] **Step 2: Add new keys to en.json**

Open `messages/en.json`. Find the existing line `"documents_review_purchase_category_other_warning": "Item category couldn't be classified — please override manually before Confirm.",` (added by purchase Task 4) and INSERT the following 7 keys IMMEDIATELY AFTER it:

```json
  "documents_review_field_passenger_name": "Passenger",
  "documents_review_field_departure_at": "Departure",
  "documents_review_field_arrival_at": "Arrival",
  "documents_review_field_travel_class": "Class",
  "documents_review_field_flight_or_train_no": "Flight / train no.",
  "documents_review_field_vehicle_plate": "Plate",
  "documents_review_field_ticket_no": "Ticket no.",
```

- [ ] **Step 3: Add new keys to zh-CN.json**

Open `messages/zh-CN.json`. Find the existing line `"documents_review_purchase_category_other_warning": "无法自动分类货物类别——请在确认前手动调整。",` and INSERT the following 7 keys IMMEDIATELY AFTER it:

```json
  "documents_review_field_passenger_name": "乘客",
  "documents_review_field_departure_at": "出发时间",
  "documents_review_field_arrival_at": "到达时间",
  "documents_review_field_travel_class": "舱位/席别",
  "documents_review_field_flight_or_train_no": "航班/车次",
  "documents_review_field_vehicle_plate": "车牌",
  "documents_review_field_ticket_no": "票号",
```

- [ ] **Step 4: Validate JSON + force paraglide regen**

```bash
cd /Users/lxz/ws/personal/carbonbook
node -e "JSON.parse(require('fs').readFileSync('messages/en.json', 'utf8')); JSON.parse(require('fs').readFileSync('messages/zh-CN.json', 'utf8')); console.log('OK');"
pnpm exec paraglide-js compile --project ./project.inlang --outdir ./src/renderer/paraglide
pnpm typecheck
```
Expected: `OK`, paraglide regenerates without warnings, typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add messages/en.json messages/zh-CN.json src/renderer/paraglide
git commit -m "feat(i18n): travel field labels"
```

---

## Task 5: `ExtractionReview` — 5th arm

**Files:**
- Modify: `src/renderer/components/ExtractionReview.tsx`

⚠️ **DO NOT REFACTOR**: the file lands at ~720 LOC after this task. **That is intentional**. The per-stage component file split is the NEXT sub-project (Phase 1.5 prep work, run BETWEEN travel.v1 and EF Matcher v1). Stick to adding a 5th arm to the existing ternaries.

You're adding:
- `TravelParsed` type (5th type)
- `TravelFields` subcomponent (5th Field-block, 12-13 rows)
- `buildTravelInitialValues` builder (5th prefill — dual-track per mode)
- 5th arm in 2 ternaries (field block JSX + initialValues JSX)

The current file (after purchase Task 5 = commit `8c3d62b`) has 4 parsed types, 4 Field-block subcomponents, 4 initial-values builders, 4-arm ternaries, and a `showCategoryOtherWarning` boolean (covers fuel + purchase).

- [ ] **Step 1: Add `TravelParsed` type and extend the discriminated union**

Find the existing `PurchaseParsed` type. Append `TravelParsed` immediately AFTER it (before the `type StageParsed = ...` line):

```ts
type TravelParsed = {
  doc_type?: string;
  supplier_name?: string;
  mode?: 'air' | 'rail' | 'taxi';
  passenger_name?: string | null;
  origin?: string;
  destination?: string;
  departure_at?: string;
  arrival_at?: string | null;
  travel_class?: string | null;
  distance_km?: number | null;
  flight_or_train_no?: string | null;
  vehicle_plate?: string | null;
  amount_yuan?: number;
  ticket_no?: string | null;
  confidence?: 'high' | 'medium' | 'low';
};
```

Then extend the `StageParsed` discriminated union. Find:
```ts
type StageParsed =
  | { stage: 'china_utility.v1'; data: ChinaUtilityParsed }
  | { stage: 'fuel_receipt.v1'; data: FuelReceiptParsed }
  | { stage: 'freight.v1'; data: FreightParsed }
  | { stage: 'purchase.v1'; data: PurchaseParsed };
```

Replace with:
```ts
type StageParsed =
  | { stage: 'china_utility.v1'; data: ChinaUtilityParsed }
  | { stage: 'fuel_receipt.v1'; data: FuelReceiptParsed }
  | { stage: 'freight.v1'; data: FreightParsed }
  | { stage: 'purchase.v1'; data: PurchaseParsed }
  | { stage: 'travel.v1'; data: TravelParsed };
```

- [ ] **Step 2: Extend the `parseExtraction` switch**

Find:
```ts
  if (promptVersion === 'purchase.v1') {
    return { stage: 'purchase.v1', data: obj as PurchaseParsed };
  }
  return null;
```

Replace with:
```ts
  if (promptVersion === 'purchase.v1') {
    return { stage: 'purchase.v1', data: obj as PurchaseParsed };
  }
  if (promptVersion === 'travel.v1') {
    return { stage: 'travel.v1', data: obj as TravelParsed };
  }
  return null;
```

- [ ] **Step 3: Add `TravelFields` subcomponent**

Find the existing `PurchaseFields` function (in the `Per-stage <dl> field blocks` section). Append immediately AFTER it:

```tsx
function TravelFields({ data }: { data: TravelParsed }) {
  return (
    <dl className="grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-4">
      <Field label={m.documents_review_field_supplier()} value={data.supplier_name} />
      <Field label={m.documents_review_field_mode()} value={data.mode} />
      <Field label={m.documents_review_field_passenger_name()} value={data.passenger_name} />
      <Field label={m.documents_review_field_origin()} value={data.origin} />
      <Field label={m.documents_review_field_destination()} value={data.destination} />
      <Field label={m.documents_review_field_departure_at()} value={data.departure_at} />
      <Field label={m.documents_review_field_arrival_at()} value={data.arrival_at} />
      <Field label={m.documents_review_field_travel_class()} value={data.travel_class} />
      <Field
        label={m.documents_review_field_distance_km()}
        value={typeof data.distance_km === 'number' ? `${data.distance_km} km` : undefined}
      />
      <Field
        label={m.documents_review_field_flight_or_train_no()}
        value={data.flight_or_train_no}
      />
      <Field label={m.documents_review_field_vehicle_plate()} value={data.vehicle_plate} />
      <Field
        label={m.documents_review_field_amount_yuan()}
        value={typeof data.amount_yuan === 'number' ? `¥${data.amount_yuan}` : undefined}
      />
      <Field label={m.documents_review_field_ticket_no()} value={data.ticket_no} />
    </dl>
  );
}
```

- [ ] **Step 4: Add `buildTravelInitialValues` builder**

Find the existing `buildPurchaseInitialValues` function. Append immediately AFTER it:

```ts
/**
 * Travel prefill: dual-track based on mode.
 *
 * Air / rail use 'passenger-km' as the unit (per-passenger emissions
 * regardless of the vehicle's other passengers). Taxi uses 'vehicle-km'
 * (the emission belongs to the vehicle, not divided across passengers).
 *
 * `amount` defaults to `distance_km` when known, else 1. The "amount=1"
 * default lets the user immediately commit a placeholder activity_data
 * row and have something show on the dashboard; once Phase 1.5 EF
 * Matcher's routing API fills the real distance, the amount can be
 * recalculated.
 *
 * `occurred_at_start = occurred_at_end = departure_at date portion`
 * (strip the time component because activity_data uses dates).
 */
function buildTravelInitialValues(
  data: TravelParsed,
  filename: string,
): import('@renderer/components/ActivityForm').ActivityFormInitialValues {
  const notesParts = [`Auto-extracted from: ${filename}`];
  if (data.supplier_name) notesParts.push(`Supplier: ${data.supplier_name}`);
  if (data.mode) notesParts.push(`Mode: ${data.mode}`);
  if (data.origin || data.destination) {
    notesParts.push(`${data.origin ?? '?'} → ${data.destination ?? '?'}`);
  }
  if (data.travel_class) notesParts.push(`Class: ${data.travel_class}`);
  if (data.flight_or_train_no) notesParts.push(`No: ${data.flight_or_train_no}`);
  if (data.vehicle_plate) notesParts.push(`Plate: ${data.vehicle_plate}`);
  if (data.ticket_no) notesParts.push(`Ticket: ${data.ticket_no}`);

  const unit = data.mode === 'taxi' ? 'vehicle-km' : 'passenger-km';
  const out: import('@renderer/components/ActivityForm').ActivityFormInitialValues = {
    unit,
    notes: notesParts.join(' · '),
  };
  // departure_at can be "YYYY-MM-DDTHH:MM" or "YYYY-MM-DD" or empty;
  // strip to date portion only for activity_data.
  if (data.departure_at) {
    const datePart = data.departure_at.split('T')[0] ?? data.departure_at;
    out.occurred_at_start = datePart;
    out.occurred_at_end = datePart;
  }
  out.amount = typeof data.distance_km === 'number' ? String(data.distance_km) : '1';
  return out;
}
```

- [ ] **Step 5: Extend the field-block JSX ternary to 5 arms**

Find the existing JSX block:
```tsx
        {parsed.stage === 'china_utility.v1' ? (
          <ChinaUtilityFields data={parsed.data} />
        ) : parsed.stage === 'fuel_receipt.v1' ? (
          <FuelReceiptFields data={parsed.data} />
        ) : parsed.stage === 'freight.v1' ? (
          <FreightFields data={parsed.data} />
        ) : (
          <PurchaseFields data={parsed.data} />
        )}
```

Replace with:
```tsx
        {parsed.stage === 'china_utility.v1' ? (
          <ChinaUtilityFields data={parsed.data} />
        ) : parsed.stage === 'fuel_receipt.v1' ? (
          <FuelReceiptFields data={parsed.data} />
        ) : parsed.stage === 'freight.v1' ? (
          <FreightFields data={parsed.data} />
        ) : parsed.stage === 'purchase.v1' ? (
          <PurchaseFields data={parsed.data} />
        ) : (
          <TravelFields data={parsed.data} />
        )}
```

- [ ] **Step 6: Extend the `initialValues` ternary to 5 arms**

Find:
```tsx
          initialValues={
            parsed.stage === 'china_utility.v1'
              ? buildChinaUtilityInitialValues(parsed.data, document.filename)
              : parsed.stage === 'fuel_receipt.v1'
                ? buildFuelReceiptInitialValues(parsed.data, document.filename)
                : parsed.stage === 'freight.v1'
                  ? buildFreightInitialValues(parsed.data, document.filename)
                  : buildPurchaseInitialValues(parsed.data, document.filename)
          }
```

Replace with:
```tsx
          initialValues={
            parsed.stage === 'china_utility.v1'
              ? buildChinaUtilityInitialValues(parsed.data, document.filename)
              : parsed.stage === 'fuel_receipt.v1'
                ? buildFuelReceiptInitialValues(parsed.data, document.filename)
                : parsed.stage === 'freight.v1'
                  ? buildFreightInitialValues(parsed.data, document.filename)
                  : parsed.stage === 'purchase.v1'
                    ? buildPurchaseInitialValues(parsed.data, document.filename)
                    : buildTravelInitialValues(parsed.data, document.filename)
          }
```

- [ ] **Step 7: Verify typecheck + lint + tests**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run --pool=threads 2>&1 | tail -5
pnpm lint --max-diagnostics=80 2>&1 | grep "ExtractionReview" | head
wc -l src/renderer/components/ExtractionReview.tsx
```

Expected:
- typecheck: clean (TypeScript narrows `parsed.data` correctly via the 5-arm discriminated union)
- vitest: 364 tests still passing (no test added/removed in this task)
- lint: no new errors
- File LOC: ~720 (no refactor — single file expected; this is the LAST sub-project at this LOC before the Phase 1.5 split)

- [ ] **Step 8: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/renderer/components/ExtractionReview.tsx
git commit -m "feat(ui): ExtractionReview — add travel.v1 5th arm to per-stage switch"
```

---

## Task 6: Integration smoke — orchestrator routes travel.v1

**Files:**
- Modify: `tests/main/services/extraction-service.test.ts`

- [ ] **Step 1: Add the test**

Open `tests/main/services/extraction-service.test.ts`. Find the closing `});` of the top-level `describe('ExtractionService', () => { ... });` block (the file's penultimate line — after the purchase smoke test that's already there from sub-project 3). Append this test inside that describe, immediately before the closing `});`:

```ts
  it('run() routes travel.v1 through the same pipeline (stage lookup + INSERT)', async () => {
    const travelOutput = {
      doc_type: 'travel' as const,
      supplier_name: '中国国际航空',
      mode: 'air' as const,
      passenger_name: '张三',
      origin: '北京首都国际机场',
      destination: '上海虹桥国际机场',
      departure_at: '2026-04-15T08:30',
      arrival_at: '2026-04-15T10:50',
      travel_class: '经济舱',
      distance_km: null,
      flight_or_train_no: 'CA1234',
      vehicle_plate: null,
      amount_yuan: 1250,
      ticket_no: '7841234567890',
      confidence: 'high' as const,
    };

    h.cleanup();
    h = setupHarness();
    h.llmClient = {
      extract: vi.fn().mockResolvedValue(travelOutput),
      extractWithImages: vi.fn(),
    } as unknown as LLMClient;

    h.extractionService = new ExtractionService({
      db: h.db,
      now: () => '2026-05-13T00:00:00.000Z',
      documentService: h.documentService,
      settingsService: h.settingsService,
      llmClient: h.llmClient,
      readFile: () => Buffer.from('travel-pdf-bytes'),
      parsePdf: vi.fn(async () => ({ text: 'FAKE_TRAVEL_TEXT' })),
    });

    const doc = uploadFakePdf(h.documentService);

    const ext = await h.extractionService.run({
      document_id: doc.id,
      stage_id: 'travel.v1',
    });

    expect(ext.status).toBe('review_needed');
    expect(ext.prompt_version).toBe('travel.v1');
    expect(JSON.parse(ext.parsed_json ?? '')).toEqual(travelOutput);
    expect(h.llmClient.extract).toHaveBeenCalledTimes(1);
    // Schema captured at the call site can parse the travel output —
    // proves the orchestrator passed travel.v1's schema, not another
    // stage's. Mirrors the technique used for fuel/freight/purchase smokes.
    const [, schema] = vi.mocked(h.llmClient.extract).mock.calls[0] ?? [];
    expect(schema).toBeDefined();
    expect(() => (schema as { parse: (x: unknown) => unknown }).parse(travelOutput)).not.toThrow();
  });
```

- [ ] **Step 2: Run the test to confirm it passes**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/services/extraction-service.test.ts --pool=threads
```
Expected: all existing extraction-service tests pass + 1 new = total 21 in this file.

- [ ] **Step 3: Run the full suite**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -5
```
Expected: 365 tests passing (364 from prior + 1 new).

- [ ] **Step 4: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add tests/main/services/extraction-service.test.ts
git commit -m "test(extraction): smoke test for travel.v1 stage routing"
```

---

## Task 7: Full test + lint sweep

**Files:** none — verification only.

- [ ] **Step 1: Run the full suite**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads
```
Expected: ≥365 tests passing.

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
```
Expected: clean exit.

- [ ] **Step 3: Run lint + format**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm format && pnpm lint --max-diagnostics=80
```
Expected: format may rewrite a few lines; lint shows only pre-existing `noNonNullAssertion` warnings and **0 errors**.

If format made changes, commit them:
```bash
cd /Users/lxz/ws/personal/carbonbook
git diff --stat
git add -A
git commit -m "chore: biome format pass for travel stage"
```

(If `git diff --stat` shows no changes, skip the commit.)

- [ ] **Step 4: Verify branch state**

```bash
cd /Users/lxz/ws/personal/carbonbook
git branch --show-current
git log --oneline -10
```
Expected: `main` (not detached).

If `git branch --show-current` returns empty:
```bash
git checkout -B main
```

---

## Closeout

Sub-project 4 of 5 (travel.v1) lands on `main` with NO tag. After this lands:

1. The IMMEDIATE next sub-project is the **per-stage component split refactor** (Phase 1.5 prep work). ExtractionReview.tsx is at ~720 LOC — that refactor moves each stage's parsed type / Field component / initial-values builder into `src/renderer/components/extractions/<stage>/{types.ts,fields.tsx,prefill.ts}` directories, leaving ExtractionReview.tsx as a thin orchestrator (~150 LOC).
2. THEN sub-project 5 (EF Matcher v1) lands.

Expected end state:
- ≥365 vitest tests passing.
- 5 stages registered (`china_utility.v1`, `fuel_receipt.v1`, `freight.v1`, `purchase.v1`, `travel.v1`).
- Upload stage dropdown auto-grows to 5 options (zero UI code change).
- ExtractionReview renders per-stage fields for all 5 stages.
- ExtractionReview is at ~720 LOC; **the per-stage component split refactor is the NEXT sub-project** (NOT this one).

Manual smoke is DEFERRED to the consolidated pre-tag verification. The phase-1d tag-time smoke covers all 5 stages + EF Matcher end-to-end.

Next sub-project: **per-stage component split refactor** (Phase 1.5 prep). Then sub-project 5: EF Matcher v1.
