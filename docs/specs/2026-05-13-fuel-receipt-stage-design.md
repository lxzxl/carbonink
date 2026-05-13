# `fuel_receipt.v1` extraction stage — design

> Status: design recommended by brainstorming session 2026-05-13, user pre-approved all six decisions.
> Next: `writing-plans` produces the implementation plan.

## §1 — Goal & scope

**Goal**: ship the second extraction stage in carbonbook so the Phase 1 deliverable ("5 种典型单据") moves from 1/5 to 2/5. Adds support for Chinese fuel receipts (加油单据): the user uploads a gas-station PDF, the AI extracts fuel type, volume, supplier, date, and amount, and the existing Confirm → ActivityForm prefill → activity_data → dashboard flow runs to completion. Identical UX shape to `china_utility.v1`; only the schema + prompt differ.

**In scope**:

- New `Stage<FuelReceiptExtraction>` registered as `fuel_receipt.v1`.
- Zod schema with **two-tier fuel typing**: `fuel_type` (string, free-form, captures the exact label on the receipt — "92#汽油" / "0#柴油" / "LPG") + `fuel_category` (enum of 8 buckets) driving EF lookup downstream.
- Both extraction paths: `buildPrompt(text)` for text-layer PDFs (Phase 1b path), `buildVisionMessages()` for scanned PDFs (Phase 1c path).
- ExtractionReview UI renders the new fields with field labels in zh-CN; existing chips + confirm/discard flow unchanged.
- ActivityForm prefill: `amount = volume_l`, `unit = 'L'`, `occurred_at_start = occurred_at_end = occurred_at` (fueling is a single-point event, not a period — both bounds set to the same day), `notes` includes supplier + license plate if present.
- License plate is captured but optional (some receipts omit it).

**Explicitly OUT of scope** (deferred to later phases):

- Multi-receipt PDFs (gas stations sometimes batch print). v1 extracts the most prominent single receipt with `confidence='low'`; full multi-record handling waits for real-user demand.
- Mileage at fill-up, VIN, receipt number. None of these affect emissions math; YAGNI.
- Auto-selection of the `emission_source` based on license plate match. Today the user manually picks the vehicle in ActivityForm; license plate stays in `notes` for cross-reference.
- Liter ↔ kilogram conversion for fuels priced by weight (rare on Chinese receipts; LPG/CNG often by m³ — handled in Phase 1d.fuel-receipt v2 if encountered).
- Vapor-recovery or biofuel-blend percentage. EF Matcher will use `fuel_category` only.
- Strict validation of `fuel_category` against the EF table. Today the enum is a hardcoded list; future EF Matcher (Phase 1.5) will tighten this via a real JOIN.

**Deliverable**: drop a real Chinese gas-station PDF (text or scan) into `/documents` → extraction populates the 9 fields → review pane shows them → Confirm opens ActivityForm prefilled (amount in liters, date, vehicle picker untouched) → submit → activity_data row written with the right EF → dashboard CO2e increments.

## §2 — Schema

```ts
// src/main/llm/stages/fuel-receipt.ts

export const fuelCategory = z.enum([
  'gasoline',      // 各种 #号汽油（92/95/98/乙醇汽油）
  'diesel',        // 0号/-10/-35 柴油
  'lpg',           // 液化石油气
  'cng',           // 压缩天然气
  'jet_fuel',      // 航空煤油
  'marine_fuel',   // 船用燃料油 / 船用柴油
  'biofuel',       // 生物燃料（B5/B20 等）
  'other',         // 模型无法分类时的兜底；UI 显示警告
]);
export type FuelCategory = z.infer<typeof fuelCategory>;

export const fuelReceiptExtraction = z.object({
  doc_type: z
    .literal('fuel_receipt')
    .describe('Always the literal "fuel_receipt".'),
  supplier_name: z
    .string()
    .describe('Gas station / supplier name (e.g. 中国石化 XX 加油站, 中国石油). Empty string if not legible.'),
  fuel_type: z
    .string()
    .describe('Fuel label exactly as printed on the receipt: "92#汽油", "0#柴油", "LPG", etc. Empty string if not legible.'),
  fuel_category: fuelCategory.describe(
    'Coarse bucket driving emission-factor lookup. ' +
      'Map gasoline grades (92/95/98/乙醇) → gasoline; diesel grades (0/-10/-35) → diesel; ' +
      'liquefied petroleum gas (LPG/液化气) → lpg; compressed natural gas (CNG/天然气) → cng; ' +
      'aviation fuel → jet_fuel; marine/船用 → marine_fuel; B5/B20/biodiesel → biofuel; ' +
      'unknown or non-fuel → other.',
  ),
  volume_l: z
    .number()
    .min(0)
    .describe('Fuel volume in liters (升/L). 0 if not legible. UI flags zero.'),
  unit_price_yuan: z
    .number()
    .min(0)
    .nullable()
    .describe('Per-liter price in CNY (元/升). null if not shown (some pre-paid receipts hide it).'),
  amount_yuan: z
    .number()
    .min(0)
    .describe('Total amount paid in CNY (元). 0 if not legible — UI flags.'),
  occurred_at: z
    .string()
    .describe('Date/time of fueling as YYYY-MM-DD. Empty string if not legible.'),
  license_plate: z
    .string()
    .nullable()
    .describe('License plate of the fueled vehicle (车牌号), or null if absent.'),
  confidence: z
    .enum(['high', 'medium', 'low'])
    .describe(
      'high: supplier + fuel_category + volume_l + amount_yuan + occurred_at all clearly visible. ' +
        'medium: 1-2 of those inferred or partially obscured. ' +
        'low: not a fuel receipt, or multiple required fields are guesses, or fuel_category=other.',
    ),
});

export type FuelReceiptExtraction = z.infer<typeof fuelReceiptExtraction>;
```

**Schema philosophy** matches `china_utility.v1`:
- Shape strict (every key present, types correct).
- Values permissive (zero numbers, empty strings allowed — model has an honest "I cannot read this" output).
- Two nullable fields: `unit_price_yuan` (often missing) and `license_plate` (often missing).
- Required-but-permissive: `fuel_type` and `occurred_at` can be empty strings; `volume_l` and `amount_yuan` can be zero. UI will flag empties at the ActivityForm step.

## §3 — Prompt

Both paths reuse a shared `FIELD_RULES` constant in the same DRY pattern as `china_utility.v1`. The text and vision prompts differ only in their first paragraph (PDF text block vs PNG attachment).

Key prompt content beyond field rules:

- **Two-tier classification instruction**: "Always populate BOTH `fuel_type` (the literal text on the receipt) AND `fuel_category` (your inferred 8-bucket classification). The category drives downstream emission-factor lookup."
- **Examples per `fuel_category` value** so the model can see edge cases (`乙醇汽油 → gasoline`, `船用柴油 → marine_fuel`).
- **YAGNI explicit**: "Ignore mileage, vehicle make, VIN, payment method, fapiao receipt number. They are not part of this stage."
- **One receipt only**: "If the PDF shows multiple receipts (gas stations sometimes batch print), extract the most prominent / largest one and set confidence='low'."

## §4 — UX delta

| Place | Change |
|---|---|
| `/documents` upload zone | The `STAGE_ID` constant in `DocumentsUpload.tsx` currently hardcodes `china_utility.v1`. We need to decide between (a) hardcoding still + adding a stage picker, or (b) letting `extraction:run` accept the user's choice via UI. **Decision: keep `china_utility.v1` hardcoded as default; add a small stage dropdown to the upload zone**. Each PDF gets classified-then-extracted by ONE stage; defaulting to `china_utility.v1` preserves Phase 1b behavior. |
| Document detail page (`documents_.$id.tsx`) | Currently shows raw `prompt_version` string. Wire it through the **existing** `stages:list` IPC (Phase 1b — already in the typed IpcMap) so the chip displays the human description ("Chinese electricity bill", "加油单据"). The fuel review pane reuses the same `ExtractionReview` component but renders different field labels — implemented via a typed switch on `extraction.prompt_version` inside `ExtractionReview`. If a 3rd stage adds, refactor to per-stage Field component. |
| `ExtractionReview` field labels | Add new i18n keys: `documents_review_field_fuel_type`, `documents_review_field_fuel_category`, `documents_review_field_volume_l`, `documents_review_field_unit_price`, `documents_review_field_occurred_at`, `documents_review_field_license_plate`. Existing supplier / amount_yuan / confidence labels are reused as-is (they're generic enough). |
| `ActivityForm` prefill | New helper `buildFuelInitialValues(parsed, filename)` mirroring `buildInitialValues` for china_utility. `amount=volume_l`, `unit='L'`, `occurred_at_start=occurred_at_end=parsed.occurred_at`, `notes` includes supplier + license_plate if non-empty. |

**Stage picker UI**: a `<select>` next to the drop zone, populated dynamically from `stages:list` IPC so adding a future stage requires zero UI code change. Each option shows the localized `description`. The drop-zone hint text adapts to the picked stage (e.g. "把电费单拖到这里" vs "把加油单拖到这里"). Last-picked stage id persists in `localStorage` (key `carbonbook.upload.last-stage`) and is pre-selected on mount; default falls back to `china_utility.v1` if nothing stored.

## §5 — File structure

| File | Status | Responsibility |
|---|---|---|
| `src/main/llm/stages/fuel-receipt.ts` | **create** | Schema, prompt, vision messages, exported `fuelReceiptStage: Stage<FuelReceiptExtraction>`. |
| `src/main/llm/stages/registry.ts` | modify | Add `fuelReceiptStage` to the registry Map. |
| `src/renderer/components/DocumentsUpload.tsx` | modify | Add stage picker (default `china_utility.v1`); pass picked stage id to `extractionApi.run`. |
| `src/renderer/components/ExtractionReview.tsx` | modify | Switch on `extraction.prompt_version` to render the right field set; for `fuel_receipt.v1` parse + render the new shape; for `china_utility.v1` no change. |
| `src/renderer/components/ActivityForm.tsx` | unchanged | The existing `initialValues` prop already supports the shape we need. |
| `messages/en.json`, `messages/zh-CN.json` | modify | New i18n keys for field labels + stage names. |
| `tests/main/llm/stages/fuel-receipt.test.ts` | **create** | Schema shape + accepts/rejects boundaries + buildPrompt/buildVisionMessages content checks (mirror china-utility.test.ts). |

## §6 — Testing

### Unit tests (vitest, no real LLM)

1. **`fuel-receipt.test.ts`** — mirror `china-utility.test.ts` shape:
   - Schema accepts a fully populated example.
   - Schema accepts `unit_price_yuan: null` and `license_plate: null`.
   - Schema accepts `volume_l: 0` and `amount_yuan: 0` and empty strings (matches the permissive-values contract).
   - Schema rejects `volume_l: -5` (consumption can be zero but never negative).
   - Schema rejects unknown `confidence` / `fuel_category` values.
   - Schema rejects `doc_type` other than `'fuel_receipt'`.
   - `chinaUtilityStage`-style metadata test: id, version, inputType, buildPrompt-includes-pdf-text, buildVisionMessages-defined-and-doesn't-include-bill-placeholder, field rules verbatim across both prompts.

2. **`registry.test.ts`** (if exists; otherwise add to `extraction-service.test.ts`) — confirm `fuel_receipt.v1` registers and is returned by `listStages()`.

### Integration smoke (existing `extraction-service.test.ts`)

One new case: stage_id `fuel_receipt.v1`, fake parsePdf returns the text of a sample receipt, assert the row lands at `review_needed` with the expected parsed JSON shape.

### Manual smoke (user verification before tagging)

1. Drag a real Chinese gas-station PDF (e.g. 中国石化 92# receipt) into /documents. Pick "加油单" from the new stage dropdown.
2. Extraction runs, lands at `review_needed` chip.
3. Open detail: see supplier / fuel_type / fuel_category / volume_l / unit_price_yuan / amount_yuan / occurred_at / license_plate / confidence rendered with zh-CN labels.
4. Click Confirm → ActivityForm opens with `amount=volume_l`, `unit='L'`, dates set, notes includes supplier + plate. User picks a vehicle emission_source + EF.
5. Submit → row appears in /activities → dashboard CO2e increments.

Also: drag a scanned-only fuel receipt → vision path triggers → same fields land.

## §7 — Risks

| Risk | Mitigation |
|---|---|
| `fuel_category='other'` for legitimate fuels we missed | UI shows a clear warning chip when `fuel_category === 'other'` AND offers manual override before Confirm. Iterate the enum after seeing real fallback rates. |
| Stage dropdown adds friction (user has to pick on every upload) | Last-picked stage is remembered in `localStorage` and pre-selected on next mount. Acceptable trade-off for the simplicity. |
| Receipt shows `volume_l` in different units (m³ for CNG, kg for some LPG) | v1 prompt explicitly says "if the unit is m³ or kg, convert to liters using a reasonable density estimate AND set confidence='medium'". Future v2 can expose `volume_unit` as a separate field if this becomes common. |
| Existing `ExtractionReview` becomes a mess of per-stage switches | Spec calls this out: 2 stages OK with a switch; refactor to per-stage Field components when adding the 3rd. |

## §8 — Out-of-scope work explicitly deferred

- **Phase 1d.freight, .purchase, .travel**: the next 3 stages. Pattern-locked by this design, but each gets its own brief brainstorm + spec + plan.
- **Phase 1.5 EF Matcher**: today the user manually picks an EF after Confirm. Once `fuel_category` is reliably populated, the EF Matcher can constrain the dropdown to the right subset. Out of scope here.
- **Multi-receipt PDFs**: single-receipt v1; if real users hit batch-printed receipts, build a `fuel_receipt_batch.v1` stage or extend `fuel_receipt.v1` schema to an array.
- **License-plate → emission_source auto-match**: future quality-of-life feature, requires the user to declare plate→vehicle mappings in Settings first.
