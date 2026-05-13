# `travel.v1` extraction stage — design

> Status: design approved through brainstorming session 2026-05-13.
> Next: `writing-plans` produces the implementation plan.
> Prior art: china_utility.v1 / fuel_receipt.v1 / freight.v1 / purchase.v1.

## §1 — Goal & scope

**Goal**: fifth and final extraction stage of Phase 1. Phase 1 deliverable was originally "5 种典型单据" (electricity / fuel / freight / purchase / travel + lodging). After this stage lands, the Phase 1 stage roster is **4 transit/goods stages + EF Matcher**. The fifth document type — lodging (酒店住宿) — is deferred to Phase 1.5 as `lodging.v1` because room-nights × per-room-night EFs belong to a different unit family from transit modes (passenger-km / vehicle-km) and forcing both into one stage produces a hybrid schema that fits neither cleanly. This is a small, conscious scope shift documented in §1 + spec §8.

Users upload a Chinese business-travel receipt (机票 / 高铁票 / 打车票), the AI extracts mode + endpoints + datetime + class + amount + reference numbers, the existing Confirm → ActivityForm → activity_data flow runs end-to-end.

**In scope**:

- New `Stage<TravelExtraction>` registered as `travel.v1`.
- Zod schema with **mode discriminator** `mode: enum(['air', 'rail', 'taxi'])` + a permissive two-tier `travel_class: string | null` (subtype within mode).
- 3 transit modes covered: **air** (机票 / e-ticket itinerary), **rail** (高铁/动车), **taxi** (打车 / 网约车 / 出租车).
- Both extraction paths: text (pdf-parse) + vision (OCR fallback) — mirrors prior 4 stages.
- ExtractionReview gets a 5th Field-block renderer (`TravelFields`) and a 5th initial-values builder.
- Stage dropdown on /documents auto-grows from 4 → 5 options via `stages:list`.
- ⚠️ **After this lands, ExtractionReview is ~720 LOC with 5-arm switches**. Spec §7 explicitly says the per-stage component split refactor IS NOW DUE — Phase 1.5 prep runs immediately after travel.v1, before EF Matcher v1.

**Explicitly OUT of scope** (deferred):

- **Hotel / lodging** (酒店住宿). Different unit family (room-nights), different EF lookup pattern, different ActivityForm prefill. Becomes `lodging.v1` in Phase 1.5 as the first stage on the new per-stage component file structure.
- **Distance estimation** by the LLM. Same rule as freight: model only fills `distance_km` if an explicit number is on the receipt (taxi receipts often print it; air/rail almost never). EF Matcher Phase 1.5 fills via routing API.
- **Passenger count > 1**. v1 assumes 1 passenger per ticket. Multi-passenger group bookings — the user manually splits in ActivityForm after Confirm. Schema does NOT include `passenger_count`.
- **Round-trip tickets as one extraction**. One PDF can contain a round-trip itinerary; v1 extracts the outbound leg as the primary record, sets confidence='medium'. Multi-leg expansion is a Phase 2 concern.
- **Multi-modal trips** (机+高铁 联程票). Same as freight's multi-modal: pick dominant leg, confidence='medium'.
- **Receipt-level VAT / surcharge breakdown** (燃油附加费, 机场建设费, 各种 fees). Aggregated into `amount_yuan` only.
- **Refund / cancellation receipts**. Model is instructed to ignore — refunds are out of accounting scope for v1.

**Deliverable**: drag a real Chinese business-travel receipt into `/documents` → pick "Chinese travel (差旅票据)" from the stage dropdown → extraction populates the 15 fields → review pane shows them → Confirm opens ActivityForm prefilled (amount = distance_km when known else 1, unit = passenger-km or vehicle-km depending on mode, occurred_at = departure date, notes joins supplier + mode + endpoints + class + ticket) → user picks emission_source + EF → submit → activity_data row → dashboard CO2e increments.

## §2 — Schema

```ts
// src/main/llm/stages/travel.ts

export const travelMode = z.enum([
  'air',   // 机票 / e-ticket itinerary / airline receipt
  'rail',  // 高铁/动车/普通火车
  'taxi',  // 出租车 / 网约车 / 打车
]);
export type TravelMode = z.infer<typeof travelMode>;

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
```

**Schema philosophy** (consistent with prior 4 stages):
- Shape strict (15 keys always present).
- Values permissive (0 / empty / null accepted as "I cannot read this").
- 7 nullable fields: `passenger_name`, `arrival_at`, `travel_class`, `distance_km`, `flight_or_train_no`, `vehicle_plate`, `ticket_no` — each commonly absent on at least one mode.

**Why so many nullables**: travel is the most heterogeneous of the 5 doc types. Air receipts have `flight_or_train_no` ("CA1234") but no `vehicle_plate`; taxi receipts have the opposite. Rather than enforce per-mode shape (which would explode to 3 stages), the nullable fields encode "this mode doesn't carry this info" honestly. The mode discriminator + nullable subtypes mirror freight's `mode` + `vehicle_class` pattern exactly.

## §3 — Prompt

Same DRY pattern — shared `FIELD_RULES` const, two entry points. Notable instructions:

1. **Mode classification examples**: each mode gets 3+ concrete examples ("CA1234 / 北京 → 上海 / 头等舱 → air"; "G102 / 上海虹桥 → 北京南 / 二等座 → rail"; "滴滴出行 / 行驶里程 8.3km → taxi").
2. **Per-mode field expectations** spelled out: which fields each mode typically fills + which are typically null.
3. **`distance_km` rule (verbatim from freight prompt, adapted)**: "Only fill if an explicit number appears on the receipt (most common on taxi). Do NOT estimate from origin/destination strings. Air/rail almost never print distance — leave null. Wrong example: 'Beijing → Shanghai → distance_km: 1200' is WRONG when no km appeared on the ticket."
4. **Round-trip handling**: "If the PDF shows BOTH outbound and return legs (common on air e-tickets), extract the OUTBOUND leg as the primary record and set confidence='medium'. The return leg becomes a separate extraction in a future v2."
5. **Ignore section**: VAT / fee breakdowns (燃油附加费 / 机场建设费 / each line separately), seat number, gate, booking agent name, frequent-flyer number, refund/cancellation info, receipt-level discounts.

Example response (verbatim in the prompt — one per mode):
```json
// Air
{"doc_type":"travel","supplier_name":"中国国际航空","mode":"air","passenger_name":"张三","origin":"北京首都国际机场","destination":"上海虹桥国际机场","departure_at":"2026-04-15T08:30","arrival_at":"2026-04-15T10:50","travel_class":"经济舱","distance_km":null,"flight_or_train_no":"CA1234","vehicle_plate":null,"amount_yuan":1250,"ticket_no":"7841234567890","confidence":"high"}

// Rail
{"doc_type":"travel","supplier_name":"中国铁路","mode":"rail","passenger_name":"李四","origin":"上海虹桥站","destination":"北京南站","departure_at":"2026-04-22T14:30","arrival_at":"2026-04-22T20:15","travel_class":"二等座","distance_km":null,"flight_or_train_no":"G102","vehicle_plate":null,"amount_yuan":553,"ticket_no":"E123456789","confidence":"high"}

// Taxi
{"doc_type":"travel","supplier_name":"滴滴出行","mode":"taxi","passenger_name":null,"origin":"浦东国际机场","destination":"上海市浦东新区","departure_at":"2026-04-15T11:30","arrival_at":null,"travel_class":null,"distance_km":42.5,"flight_or_train_no":null,"vehicle_plate":"沪A12345","amount_yuan":180,"ticket_no":"DD20260415123","confidence":"high"}
```

(All 3 examples in the prompt body — the model needs to see the full shape per mode to handle nulls correctly.)

## §4 — UX delta

| Place | Change |
|---|---|
| `/documents` upload zone | Stage dropdown auto-grows from 4 → 5 options via `stages:list`. Zero code change. |
| `ExtractionReview` per-stage rendering | Add `TravelFields` component (12-13 field rows; mode-specific fields render "—" when null, identical UX to freight's `vehicle_class`). Switch on `parsed.stage === 'travel.v1'`. The existing 4-arm ternary becomes 5-arm. **BUT this is the LAST sub-project before the per-stage component split refactor** — the next thing to land after travel.v1 is moving each stage's parsed type / Field component / initial-values builder into `src/renderer/components/extractions/<stage>/` directories. See §7. |
| `ExtractionReview` prefill builder | Add `buildTravelInitialValues(data, filename)`:<br>- `amount = String(data.distance_km ?? 1)` (default 1 when unknown, so EF Matcher Phase 1.5 can recalc on real distance)<br>- `unit = data.mode === 'taxi' ? 'vehicle-km' : 'passenger-km'` (transit air/rail uses passenger-km EFs; taxi uses vehicle-km because the emission belongs to the vehicle not per-passenger)<br>- `occurred_at_start = occurred_at_end = data.departure_at.split('T')[0]` (date portion only — activity_data uses date, not datetime)<br>- `notes` joins filename + supplier + mode + `origin → destination` + travel_class + flight_or_train_no / vehicle_plate + ticket_no (each only if non-empty / non-null) |
| `documents_review_field_*` i18n | 9 new keys: mode (reusable name from freight — but freight already has `documents_review_field_mode`; check for clash, REUSE the existing key), passenger_name, departure_at, arrival_at, travel_class, flight_or_train_no, vehicle_plate, ticket_no. (supplier, origin, destination, distance_km, amount_yuan, confidence reuse existing keys from freight + purchase.) |

**i18n note**: freight already added `documents_review_field_mode` and `documents_review_field_origin/destination/distance_km`. travel.v1 REUSES these (`mode` value renders as the raw enum which is fine for v1; origin/destination labels are domain-neutral; distance_km label is identical). Only 8 NEW keys land:
- `passenger_name`, `departure_at`, `arrival_at`, `travel_class`, `flight_or_train_no`, `vehicle_plate`, `ticket_no`, plus `documents_review_travel_class_other_warning` — no, scrap the warning chip for v1: `travel_class` is freeform, no enum, no 'other' bucket. So just 7 new label keys.

## §5 — File structure

| File | Status | Responsibility |
|---|---|---|
| `src/main/llm/stages/travel.ts` | **create** | `travelMode` enum, `travelExtraction` schema (15 fields), inferred types, `travelStage`. Mirrors freight/purchase structure. |
| `src/main/llm/stages/registry.ts` | modify | Add `travelStage` to `_stageRegistry` Map (5th entry). |
| `tests/main/llm/stages/travel.test.ts` | **create** | ~16 tests: schema accept/reject boundaries, all 3 mode values, stage metadata + prompt content, registry integration. |
| `tests/main/llm/stages/registry.test.ts` | modify | Bump expected stage count 4 → 5 + add `travel.v1` to id-set assertions. |
| `messages/en.json`, `messages/zh-CN.json` | modify | 7 new field-label keys. |
| `src/renderer/components/ExtractionReview.tsx` | modify | Add `TravelParsed` type, `TravelFields` subcomponent, `buildTravelInitialValues` builder, 5th arm in 2 ternaries. **NO file refactor in this sub-project — that's the NEXT sub-project (Phase 1.5 prep).** File lands at ~720 LOC. |
| `tests/main/services/extraction-service.test.ts` | modify | One new smoke test for `travel.v1` stage routing. |

## §6 — Testing

### Unit tests (vitest, no real LLM)

1. **`travel.test.ts`** mirrors `freight.test.ts`:
   - Schema accepts happy-path for each of 3 modes (3 separate `it()` blocks with mode-specific GOOD objects).
   - Schema accepts all 7 nullable fields set to null.
   - Schema accepts permissive zero / empty / non-ISO values (amount_yuan=0, empty origin, non-ISO departure_at).
   - Schema rejects negative amount_yuan, negative distance_km.
   - Schema rejects unknown mode, unknown confidence, wrong doc_type.
   - Schema accepts each of 3 valid mode values.
   - Stage metadata + prompt-content tests (text wrapper `<ticket>`, all 3 mode strings in prompt, "Do NOT estimate" verbatim).
   - Registry integration: `getStage('travel.v1') === travelStage`; `listStages()` returns all 5 ids.

2. **`registry.test.ts`** updated: 4 → 5 stages.

3. **`extraction-service.test.ts`** gains one travel routing smoke (verbatim pattern of fuel/freight/purchase smokes).

### Manual smoke (deferred to consolidated pre-tag verification)

Postponed to the phase-1d tag-time smoke. Will include:
- Real 国航 e-ticket → mode=air, departure_at populated → Confirm → activity_data.
- Real 12306 高铁 receipt → mode=rail.
- Real 滴滴打车 receipt → mode=taxi, distance_km populated.

## §7 — Risks & open questions

| Risk | Mitigation |
|---|---|
| Mode mis-classification on edge cases (e.g. 机场专线大巴 — is it taxi? air shuttle?) | Model picks closest + `confidence='medium'`. Real-user usage data will tell us if we need a 4th mode (`shuttle` / `coach`). |
| Round-trip e-tickets — model picks outbound, return leg lost | Spec calls this out as v1 acceptable behavior with `confidence='medium'`. v2 expands schema to include `legs: array` if real users hit this. |
| Taxi receipts in pure-image format from older taxi printers (scanned bills, no text layer) | Vision path covers this. No regression vs prior stages. |
| `distance_km` is `null` for most air/rail extractions → ActivityForm prefills `amount=1` which produces tiny CO2e | Acceptable for v1: user clearly sees "distance unknown" in fields and can manually override to a reasonable estimate in ActivityForm. Phase 1.5 EF Matcher's routing API closes this loop properly. |
| ExtractionReview hits ~720 LOC — well past the "split" threshold | THIS sub-project is the LAST one to add an arm to the single-file switch. The next thing to land after travel.v1 (before EF Matcher v1) is the per-stage component split refactor. See §8. |
| `passenger_name` extraction may surface privacy concerns | The field stays inside the extraction row and notes; never displayed in dashboard / charts. Phase 1d may add a privacy-mode toggle to mask names. Acceptable for v1. |

## §8 — Out-of-scope work explicitly deferred

- **Sub-project 5 (EF Matcher v1)**: FTS5 + LLM-recommended EF picker + routing API integration. The travel `distance_km` nullable design feeds directly into the EF Matcher's routing module.
- **Phase 1.5 ExtractionReview per-stage component split**: REQUIRED to run BETWEEN travel.v1 (this sub-project) and the EF Matcher. Moves `ChinaUtilityParsed` / `FuelReceiptParsed` / `FreightParsed` / `PurchaseParsed` / `TravelParsed` types, their Field components, and their initial-values builders into `src/renderer/components/extractions/<stage>/{types.ts,fields.tsx,prefill.ts}` directories. The 5-arm ExtractionReview.tsx becomes a thin orchestrator (~150 LOC). This is the explicit refactor sub-project §1+§7 keep referencing.
- **`lodging.v1` stage**: Phase 1.5 work. First stage to land on the new per-stage component structure. Schema: hotel chain + city + check_in/check_out dates + room_nights + amount_yuan + invoice_no. Unit: 'room-nights'. EF: per-room-night by hotel-class.
- **Round-trip multi-leg expansion**: schema-level `legs: array` change. Phase 2.
- **Multi-passenger group bookings**: requires `activity_data` table to support multiple rows from one extraction (parent_extraction_id, same as line-items deferred from purchase). Phase 2.
- **Multi-modal trips** (机+高铁 联程): split-into-multiple-legs again. Phase 2.
- **Refund / cancellation receipts**: out of accounting scope; not modeled.
