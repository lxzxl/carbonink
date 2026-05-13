# `freight.v1` extraction stage — design

> Status: design approved through brainstorming session 2026-05-13.
> Next: `writing-plans` produces the implementation plan.
> Prior art: `china_utility.v1` (Phase 1b), `fuel_receipt.v1` (just shipped — `docs/specs/2026-05-13-fuel-receipt-stage-design.md`).

## §1 — Goal & scope

**Goal**: third extraction stage. Phase 1 deliverable ("5 种典型单据") moves from 2/5 to 3/5. Users upload a Chinese freight / shipping document (运输单 / 物流单 / 提单), AI extracts mode + weight + endpoints + amount + date, the existing Confirm → ActivityForm → activity_data flow runs end-to-end. Architecture and UX shape are identical to fuel_receipt.v1; only the schema + prompt differ.

**In scope**:

- New `Stage<FreightExtraction>` registered as `freight.v1`.
- Zod schema with **mode discriminator** (`mode: enum(['road','rail','sea','air'])`) plus a permissive `vehicle_class: string | null` for the within-mode subtype (车型 / 船型 / 机型).
- `distance_km: number | null` — model only fills when an explicit number appears on the receipt; otherwise stays null and Phase 1.5 EF Matcher fills it from origin/destination + a routing API.
- `tracking_no: string | null` — single field for BL number, container number, train number, flight number (mode-dependent; all unified to one string).
- Both extraction paths: text + vision, mirroring fuel_receipt.
- ExtractionReview gets a third Field-block renderer (`FreightFields`) and a third initial-values builder.
- Stage dropdown on /documents (already wired in fuel_receipt task 5) automatically grows from 2 → 3 options via `stages:list`.

**Explicitly OUT of scope** (deferred):

- Multi-leg shipments (export PDFs sometimes show 国内段 + 国际段). v1 treats them as a single shipment with the cumulative weight + cumulative distance if known.
- Multi-shipment PDFs. v1 extracts the most prominent / largest shipment with `confidence='low'` if multiple are visible.
- Container number → reefer (refrigerated) detection. Reefer freight EFs are heavier than dry; deferred until the EF Matcher (Phase 1.5) supports the distinction.
- Auto-distance estimation by the LLM. Spec explicitly forbids it (Brainstorm Q2 answer B).
- Per-mode field set divergence. v1 ships one schema; the unused fields render as "—" for modes that don't carry them (e.g. `vehicle_class` is meaningful for road, often blank for sea).
- Vapor-recovery / SAF-blend (Sustainable Aviation Fuel) signal for air mode. Future EF Matcher concern.

**Deliverable**: drag a real Chinese freight receipt (公路货运单 / 海运提单 BL / 中欧班列运单 / 航空货运单) into `/documents` → pick "Chinese freight (运输单据)" from the stage dropdown → extraction populates the 11 fields → review pane shows them → Confirm opens ActivityForm prefilled (amount in kg, single-day, notes includes endpoints + mode + tracking) → user picks emission_source + EF → submit → activity_data row → dashboard CO2e ticks up.

## §2 — Schema

```ts
// src/main/llm/stages/freight.ts

export const freightMode = z.enum([
  'road',  // 公路 (truck, van, last-mile)
  'rail',  // 铁路 (含中欧班列)
  'sea',   // 海运 (集装箱 / 散货)
  'air',   // 航空 (货机 / 客机腹舱)
]);
export type FreightMode = z.infer<typeof freightMode>;

export const freightExtraction = z.object({
  doc_type: z
    .literal('freight')
    .describe('Always the literal "freight".'),
  supplier_name: z
    .string()
    .describe('Carrier / logistics provider name, e.g. "中远海运", "顺丰速运", "中铁集装箱". Empty string if not legible.'),
  mode: freightMode.describe(
    'Transport mode discriminator. road = trucks / vans / last-mile; rail = 铁路 / 中欧班列; ' +
      'sea = ocean container or bulk; air = air cargo (freighter or belly hold).',
  ),
  vehicle_class: z
    .string()
    .nullable()
    .describe(
      'Free-text within-mode subtype: road may show "8 轴货车" or "冷链车" or "液化气罐车"; ' +
        'sea shows "20ft 集装箱" / "40ft" / "散货"; rail shows "C70" or "X70"; air shows "B777F" or "客机腹舱". ' +
        'null if not legible — affects only EF refinement, not the gross calculation.',
    ),
  weight_kg: z
    .number()
    .min(0)
    .describe(
      'Cargo gross weight in KILOGRAMS. If the receipt shows "吨/T", multiply by 1000. ' +
        'If "千克/公斤/kg", direct. 0 if not legible — UI flags. (Freight EFs are per-kg or per-tonne-km; ' +
        'we store kg as the canonical unit and let downstream conversion handle the rest.)',
    ),
  volume_m3: z
    .number()
    .min(0)
    .nullable()
    .describe(
      'Cargo volume in cubic meters. Mostly relevant for air (where chargeable weight = max(actual, volumetric)) ' +
        'and occasionally LCL ocean. null if absent.',
    ),
  distance_km: z
    .number()
    .min(0)
    .nullable()
    .describe(
      'Transport distance in kilometers. Fill ONLY if an explicit numeric distance appears on the receipt ' +
        '(highway toll receipts, some 中欧班列 documents). Do NOT estimate from origin/destination strings — ' +
        'leave null. The EF Matcher fills this from origin/destination at Confirm time using a routing API.',
    ),
  origin: z
    .string()
    .describe(
      'Origin / loading location, e.g. "深圳市宝安区", "Hamburg", "Shanghai Yangshan Port". ' +
        'Empty string if not legible.',
    ),
  destination: z
    .string()
    .describe(
      'Destination / unloading location. Empty string if not legible. Format follows the receipt — no normalization.',
    ),
  tracking_no: z
    .string()
    .nullable()
    .describe(
      'Single tracking identifier — picks the most prominent of: ' +
        'sea bill of lading (B/L) number, sea container number (e.g. CSQU3054383), ' +
        'rail train number / waybill, ' +
        'road waybill / 货运单号, ' +
        'air air waybill (AWB) number. null if absent.',
    ),
  amount_yuan: z
    .number()
    .min(0)
    .describe('Total freight charges in CNY (元 / 应付运费 / 总费用). 0 if not legible.'),
  occurred_at: z
    .string()
    .describe(
      'Shipment / loading date as YYYY-MM-DD. Freight is a single-point event for accounting purposes ' +
        '(both start and end set to this date). Empty string if not legible. ' +
        'If both loading and delivery dates appear, use the LOADING date.',
    ),
  confidence: z
    .enum(['high', 'medium', 'low'])
    .describe(
      'high: supplier_name + mode + weight_kg + origin + destination + amount_yuan + occurred_at all clearly visible. ' +
        'medium: 1-2 inferred or partially obscured. ' +
        'low: not a freight document, OR multiple required fields are guesses, OR mode is ambiguous.',
    ),
});

export type FreightExtraction = z.infer<typeof freightExtraction>;
```

**Schema philosophy** (consistent with china_utility and fuel_receipt):
- Shape strict (11 keys always present).
- Values permissive (0 / empty / null accepted as "I cannot read this").
- Three nullable fields: `vehicle_class`, `volume_m3`, `distance_km`, `tracking_no` — all commonly absent or ambiguous.

**Why `tracking_no` is one field instead of per-mode**: each shipment has one canonical identifier the user needs for cross-reference. Container number, BL number, AWB, train waybill — they're all "the string that uniquely identifies this shipment". Treating them as one string preserves the audit trail without exploding the schema.

**Why `distance_km` is nullable, not zero-default**: explicit "we don't know" is more honest than "0 km", and the EF Matcher (Phase 1.5) keys on `distance_km !== null` to decide whether to call the routing API.

## §3 — Prompt

Same DRY pattern as fuel_receipt — a shared `FIELD_RULES` const, two entry points (`buildPrompt(pdfText)` and `buildVisionMessages()`). The differences from fuel_receipt's prompt:

1. **Mode classification examples**: each of the 4 enum values gets 2-3 concrete examples ("中欧班列 → rail", "上海港 → 宁波港 → sea", "FedEx AWB → air").
2. **The `distance_km` instruction is unusually emphatic** — the LLM MUST NOT estimate from origin/destination. Wrong example included: `"深圳 → 汉堡, distance_km: 19000" is WRONG. Leave it null instead.`
3. **Mode-specific tracking_no hints** — what to pick first when multiple identifiers appear.
4. **Weight-unit normalization**: convert 吨 → kg by ×1000 in-prompt.
5. **The "ignore" section**: similar to fuel_receipt — explicitly exclude payment method, fapiao number, customs declaration code, cargo description detail (we only need totals).

Example response JSON (verbatim from the prompt):
```json
{"doc_type":"freight","supplier_name":"顺丰速运","mode":"road","vehicle_class":"冷链车","weight_kg":1250,"volume_m3":4.5,"distance_km":null,"origin":"广州市番禺区","destination":"上海市浦东新区","tracking_no":"SF1234567890","amount_yuan":2680,"occurred_at":"2026-05-08","confidence":"high"}
```

## §4 — UX delta

| Place | Change |
|---|---|
| `/documents` upload zone | Stage dropdown automatically grows to 3 options via `stages:list` — zero code change in `DocumentsUpload.tsx` (fuel_receipt task 5 already made this list-driven). |
| `ExtractionReview` per-stage rendering | Add `FreightFields` component (11 field rows including a small label transform: "mode" displayed as "road / rail / sea / air" — the raw enum value is acceptable for v1; localized labels can ship in a follow-up). Switch on `parsed.stage === 'freight.v1'`. |
| `ExtractionReview` prefill builder | Add `buildFreightInitialValues(data, filename)`: `amount=String(weight_kg)`, `unit='kg'`, `occurred_at_start=occurred_at_end=data.occurred_at`, `notes` joins (filename + supplier + `origin → destination` + mode + tracking_no) where each piece is included only if non-empty / non-null. |
| `ExtractionReview` ActivityForm switch | Three-arm switch on `parsed.stage` (china_utility / fuel_receipt / freight). At this point the file is at ~430 LOC; spec §7 of the fuel_receipt design called for refactoring per-stage parts into their own files at the 3-stage mark — this design DOES NOT do that refactor (deferred to Phase 1.5 along with EF Matcher). Rationale below in §7. |
| `documents_review_field_*` i18n | 7 new keys: mode, vehicle_class, weight_kg, volume_m3, distance_km, origin, destination, tracking_no. (Supplier, amount_yuan, occurred_at, confidence reuse existing fuel_receipt keys.) |

The per-stage spinner-flip, retry-after-discard-preserves-stage, and parsed-state banner are all Phase 1c additions that already work for any registered stage — no change.

## §5 — File structure

| File | Status | Responsibility |
|---|---|---|
| `src/main/llm/stages/freight.ts` | **create** | `freightMode` enum, `freightExtraction` schema, `FreightExtraction` type, `freightStage`. Mirrors fuel_receipt structure exactly. |
| `src/main/llm/stages/registry.ts` | modify | Add `freightStage` to the `_stageRegistry` Map (3rd entry). |
| `tests/main/llm/stages/freight.test.ts` | **create** | Schema accept/reject boundaries (12 tests targeted) + stage metadata + registry integration. Pattern-locked by china-utility.test.ts and fuel-receipt.test.ts. |
| `tests/main/llm/stages/registry.test.ts` | modify | Bump expected stage count 2 → 3 (mirror what Task 3 of fuel_receipt did). |
| `messages/en.json`, `messages/zh-CN.json` | modify | 7 new field-label keys (mode / vehicle_class / weight_kg / volume_m3 / distance_km / origin / destination / tracking_no). |
| `src/renderer/components/ExtractionReview.tsx` | modify | Add `FreightParsed` type, `FreightFields` subcomponent, `buildFreightInitialValues`, 3-arm switch in the JSX. |
| `tests/main/services/extraction-service.test.ts` | modify | One new smoke test mirroring the fuel_receipt one (Task 8 of fuel_receipt) — verifies stage_id routing + schema reachability. |

## §6 — Testing

Same shape as the fuel_receipt plan:

### Unit tests (vitest, no real LLM)

1. **`freight.test.ts`** mirrors `fuel-receipt.test.ts`:
   - Schema accepts a fully populated happy-path object.
   - Schema accepts each of the 4 nullable fields (`vehicle_class`, `volume_m3`, `distance_km`, `tracking_no`) set to null.
   - Schema accepts `weight_kg: 0`, `amount_yuan: 0`, empty `origin`/`destination` (permissive contract).
   - Schema accepts non-ISO / empty `occurred_at`.
   - Schema rejects negative `weight_kg`, `amount_yuan`, `volume_m3`, `distance_km`.
   - Schema rejects unknown `mode` value.
   - Schema rejects unknown `confidence` value.
   - Schema rejects `doc_type` other than `'freight'`.
   - Stage metadata: id `'freight.v1'`, version `'1.0.0'`, `inputType: 'pdf_text'`, both prompt builders defined.
   - Prompt content: text path embeds `<receipt>${pdfText}</receipt>`; both paths include "freight" / "mode" / "weight_kg" / examples of each mode enum value.
   - Registry integration: `getStage('freight.v1') === freightStage`; `listStages()` returns all 3 ids.

2. **`registry.test.ts`** updated to expect 3 stages.

3. **`extraction-service.test.ts`** gains one freight routing smoke test (verbatim pattern of the fuel_receipt one).

### Manual smoke (deferred to consolidated pre-tag verification)

Postponed to the phase-1d tag-time smoke (after all 4 stages + EF Matcher land). Includes:
- Upload a real Chinese road freight 货运单 → pick "Chinese freight" → extract → Confirm → activity_data → dashboard.
- Upload a real ocean BL → same.
- Upload a 中欧班列 运单 → same.
- Upload an air AWB → same.

## §7 — Risks & open questions

| Risk | Mitigation |
|---|---|
| `mode` mis-classification on edge cases (e.g. multi-modal: 海铁联运) | v1 picks the dominant mode + confidence='medium' or 'low'. Future v2 could ship `mode_secondary` for multi-modal — but that's downstream of real-user usage data. |
| `weight_kg` confusion when receipt shows "吨" without explicit unit context | Prompt explicitly tells the model: "if 'T' / '吨' appears next to the number, multiply by 1000". Test fixture includes a "5.5 吨" example in the prompt's worked-example block. |
| 3-arm switch in `ExtractionReview` becomes unwieldy | At the 4-stage mark (travel.v1 lands), refactor to `src/renderer/components/extractions/<stage>/` directories. THIS spec consciously does NOT do that refactor — keeping the switch makes the diff readable and the refactor itself is mechanical enough to do as a Phase 1.5 prep task before EF Matcher. |
| Origin / destination string normalization for downstream EF Matcher distance API | Out of scope here; EF Matcher Phase 1.5 owns geocoding. `freight.v1` just records what the LLM saw. |
| `distance_km` always null → user can't compute meaningful CO2e at Confirm time before EF Matcher lands | Acceptable for v1: ActivityForm prefills `amount=weight_kg, unit='kg'`, user picks a "per-kg" EF (GHG Protocol has these for trucking and per-mode air freight). Once EF Matcher lands, the prefill switches to `amount=weight_kg * distance_km / 1000` with `unit='tonne-km'` and a more accurate EF. |

## §8 — Out-of-scope work explicitly deferred

- **Sub-projects 3/4 of Phase 1 (purchase / travel)**: each gets its own brief brainstorm + spec + plan + execute. Pattern-locked by this design.
- **Sub-project 5 (EF Matcher v1)**: FTS5 + LLM-recommended EF picker + distance-API integration for freight. The `distance_km` nullable design here is the EF Matcher's "todo" hook.
- **Phase 1.5 ExtractionReview refactor**: split per-stage into `src/renderer/components/extractions/<stage>/`. Spec §4 + §7 explicitly call this out as a 4-stage-mark refactor; this design ships before that refactor.
- **Reefer detection from container number prefix**: needs an EF table with reefer differentiation first.
- **Multi-leg / inter-modal shipments**: schema-shape change waits for real user demand.
