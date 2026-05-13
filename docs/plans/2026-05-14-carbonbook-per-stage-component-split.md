# Per-Stage Component Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `src/renderer/components/ExtractionReview.tsx` (698 LOC, single file) into per-stage component directories. Orchestrator shrinks to ~270 LOC. **Behavior identical. No new features. No new tests.**

**Architecture:** 5 per-stage folders under `src/renderer/components/extractions/<stage>/` each owning `types.ts` + `fields.tsx` + `prefill.ts`. Plus 2 cross-stage glue files (`extractions/types.ts` for the discriminated union + parseExtraction, `extractions/shared.tsx` for the Field row helper + confidence maps). 18 files total.

**Tech Stack:** TypeScript, React 18, paraglide i18n, vitest. No new deps.

**Reference spec:** `docs/specs/2026-05-14-per-stage-component-split-design.md`

**Baseline:** `commit 892ca7c` on `main`. 381 vitest tests passing. ExtractionReview.tsx is the single consumer; only `src/renderer/routes/documents_.$id.tsx` imports `ExtractionReview` (the type, not its internals).

**Discipline notes:**
- The discriminated union's discriminator tag is `stage` (not `kind`) — preserve it exactly.
- The 207-LOC main component body (lines 187-393) stays put.
- The implementer must NOT rename any exported symbol.
- The implementer must NOT change function bodies (only imports adjust as moves happen).
- Inline type imports like `import('@renderer/components/ActivityForm').ActivityFormInitialValues` should be lifted to top-level `import type { ActivityFormInitialValues } from '@renderer/components/ActivityForm';` in each new prefill.ts — this is the only mechanical cleanup the move permits.
- After each task: typecheck must pass, `pnpm vitest run --pool=threads` must report 381 tests passing.
- Pre-existing hazard: if vitest dumps 184+ failures with `NODE_MODULE_VERSION 145`, run `rm /Users/lxz/ws/personal/carbonbook/node_modules/.pnpm/better-sqlite3@12.9.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node && (cd /Users/lxz/ws/personal/carbonbook && pnpm rebuild better-sqlite3)`. Not a regression.
- After each commit: verify `git branch --show-current` returns `main` (not detached). If empty: `git checkout -B main`.

---

## Task 1: Extract shared helpers — `extractions/shared.tsx`

**Files:**
- Create: `src/renderer/components/extractions/shared.tsx`
- Modify: `src/renderer/components/ExtractionReview.tsx` (remove inline `Field`, `CONFIDENCE_CLASSES`, `CONFIDENCE_LABELS`; add import)

- [ ] **Step 1: Create the shared module**

Create `src/renderer/components/extractions/shared.tsx` with this exact content:

```tsx
import * as m from '@renderer/paraglide/messages';

/**
 * Generic dl-row renderer used by every per-stage Fields component.
 * Renders an em-dash for empty/null/undefined values so the layout
 * stays stable.
 */
export function Field({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  const display = value === null || value === undefined || value === '' ? '—' : String(value);
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{display}</dd>
    </>
  );
}

export const CONFIDENCE_CLASSES: Record<'high' | 'medium' | 'low', string> = {
  high: 'border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary)]/10 text-[color:var(--color-primary)]',
  medium: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  low: 'border-destructive/40 bg-destructive/10 text-destructive',
};

export const CONFIDENCE_LABELS: Record<'high' | 'medium' | 'low', () => string> = {
  high: m.documents_review_confidence_high,
  medium: m.documents_review_confidence_medium,
  low: m.documents_review_confidence_low,
};
```

- [ ] **Step 2: Update `ExtractionReview.tsx`**

In `src/renderer/components/ExtractionReview.tsx`:

1. Add to the import block (alphabetically positioned among the other `@renderer/components/*` imports):
   ```ts
   import { CONFIDENCE_CLASSES, CONFIDENCE_LABELS, Field } from '@renderer/components/extractions/shared';
   ```
2. Delete the `CONFIDENCE_CLASSES` const block (currently lines 171-175) AND the surrounding `// Confidence chip mapping` divider comment (lines 167-170).
3. Delete the `CONFIDENCE_LABELS` const block (currently lines 177-181).
4. Delete the `Field` function (currently lines 690-697) AND the surrounding `// Generic field row` divider comment (lines 686-689).

- [ ] **Step 3: Run typecheck**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
```
Expected: clean exit. (If errors mention missing `Field`/`CONFIDENCE_*`, the import in step 2 is wrong or the deletion was incomplete.)

- [ ] **Step 4: Run the full test suite**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -10
```
Expected: 381 tests passing.

- [ ] **Step 5: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/renderer/components/extractions/shared.tsx src/renderer/components/ExtractionReview.tsx
git commit -m "refactor(ui): extract shared Field + confidence maps to extractions/shared"
git branch --show-current
```
Expected branch: `main`. If empty, `git checkout -B main`.

---

## Task 2: Move china-utility — `extractions/china-utility/`

**Files:**
- Create: `src/renderer/components/extractions/china-utility/types.ts`
- Create: `src/renderer/components/extractions/china-utility/fields.tsx`
- Create: `src/renderer/components/extractions/china-utility/prefill.ts`
- Modify: `src/renderer/components/ExtractionReview.tsx` (remove the 3 inline declarations + add 3 imports + drop unused references)

- [ ] **Step 1: Create `types.ts`**

`src/renderer/components/extractions/china-utility/types.ts`:

```ts
export type ChinaUtilityParsed = {
  doc_type?: string;
  supplier_name?: string;
  account_no?: string | null;
  amount_kwh?: number;
  amount_yuan?: number | null;
  period_start?: string;
  period_end?: string;
  confidence?: 'high' | 'medium' | 'low';
};
```

- [ ] **Step 2: Create `fields.tsx`**

`src/renderer/components/extractions/china-utility/fields.tsx`:

```tsx
import { Field } from '../shared';
import * as m from '@renderer/paraglide/messages';
import type { ChinaUtilityParsed } from './types';

export function ChinaUtilityFields({ data }: { data: ChinaUtilityParsed }) {
  return (
    <dl className="grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-4">
      <Field label={m.documents_review_field_supplier()} value={data.supplier_name} />
      <Field label={m.documents_review_field_account()} value={data.account_no} />
      <Field label={m.documents_review_field_kwh()} value={data.amount_kwh} />
      <Field label={m.documents_review_field_amount()} value={data.amount_yuan} />
      <Field label={m.documents_review_field_period_start()} value={data.period_start} />
      <Field label={m.documents_review_field_period_end()} value={data.period_end} />
    </dl>
  );
}
```

Verify the body against the current `ChinaUtilityFields` in `ExtractionReview.tsx` (around line 394-411). The Field rows must match exactly — same `m.documents_review_field_*` keys, same `data.*` accessors, same row order. **If your reading of the source disagrees with the snippet above, trust the source — copy the rows verbatim.**

- [ ] **Step 3: Create `prefill.ts`**

`src/renderer/components/extractions/china-utility/prefill.ts`:

```ts
import type { ActivityFormInitialValues } from '@renderer/components/ActivityForm';
import type { ChinaUtilityParsed } from './types';

export function buildChinaUtilityInitialValues(
  data: ChinaUtilityParsed,
  filename: string,
): ActivityFormInitialValues {
  const out: ActivityFormInitialValues = {
    unit: 'kWh',
    notes: `Auto-extracted from: ${filename}`,
  };
  if (data.period_start) out.occurred_at_start = data.period_start;
  if (data.period_end) out.occurred_at_end = data.period_end;
  if (typeof data.amount_kwh === 'number') out.amount = String(data.amount_kwh);
  return out;
}
```

Note: the inline `import('@renderer/components/ActivityForm').ActivityFormInitialValues` in the source has been lifted to a top-level `import type`. This is intentional cleanup; body is identical.

- [ ] **Step 4: Update `ExtractionReview.tsx`**

1. Add to the imports block:
   ```ts
   import { ChinaUtilityFields } from '@renderer/components/extractions/china-utility/fields';
   import { buildChinaUtilityInitialValues } from '@renderer/components/extractions/china-utility/prefill';
   import type { ChinaUtilityParsed } from '@renderer/components/extractions/china-utility/types';
   ```
2. Delete the inline `type ChinaUtilityParsed = { ... }` declaration (around lines 51-60).
3. Delete the inline `function ChinaUtilityFields(...) { ... }` declaration (around lines 394-411).
4. Delete the inline `function buildChinaUtilityInitialValues(...) { ... }` declaration (around lines 524-536).
5. **Do not** touch the `StageParsed` union, `parseExtraction`, or the JSX switch arms — they still reference the type and the functions, but now via the imports.

- [ ] **Step 5: Typecheck + vitest**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run --pool=threads 2>&1 | tail -10
```
Both clean. 381 tests passing.

- [ ] **Step 6: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/renderer/components/extractions/china-utility/ src/renderer/components/ExtractionReview.tsx
git commit -m "refactor(ui): split china-utility into extractions/china-utility/{types,fields,prefill}"
git branch --show-current
```

---

## Task 3: Move fuel-receipt — `extractions/fuel-receipt/`

**Files:**
- Create: `src/renderer/components/extractions/fuel-receipt/types.ts`
- Create: `src/renderer/components/extractions/fuel-receipt/fields.tsx`
- Create: `src/renderer/components/extractions/fuel-receipt/prefill.ts`
- Modify: `src/renderer/components/ExtractionReview.tsx`

- [ ] **Step 1: Create `types.ts`**

`src/renderer/components/extractions/fuel-receipt/types.ts`:

```ts
export type FuelReceiptParsed = {
  doc_type?: string;
  supplier_name?: string;
  fuel_type?: string;
  fuel_category?:
    | 'gasoline'
    | 'diesel'
    | 'lpg'
    | 'cng'
    | 'jet_fuel'
    | 'marine_fuel'
    | 'biofuel'
    | 'other';
  volume_l?: number;
  unit_price_yuan?: number | null;
  amount_yuan?: number;
  occurred_at?: string;
  license_plate?: string | null;
  confidence?: 'high' | 'medium' | 'low';
};
```

- [ ] **Step 2: Create `fields.tsx`**

`src/renderer/components/extractions/fuel-receipt/fields.tsx`:

Copy the `FuelReceiptFields` function body verbatim from `ExtractionReview.tsx` (around lines 413-435). Wrap with imports:

```tsx
import { Field } from '../shared';
import * as m from '@renderer/paraglide/messages';
import type { FuelReceiptParsed } from './types';

export function FuelReceiptFields({ data }: { data: FuelReceiptParsed }) {
  // body from source — same JSX, same field rows
}
```

If `FuelReceiptFields` uses any helper not yet imported (e.g., a warning constant), preserve those imports inline. Most likely only `Field` + `m`.

- [ ] **Step 3: Create `prefill.ts`**

`src/renderer/components/extractions/fuel-receipt/prefill.ts`:

```ts
import type { ActivityFormInitialValues } from '@renderer/components/ActivityForm';
import type { FuelReceiptParsed } from './types';

export function buildFuelReceiptInitialValues(
  data: FuelReceiptParsed,
  filename: string,
): ActivityFormInitialValues {
  // body from source — lift the inline import to the top-level import type above
}
```

The function body comes from `ExtractionReview.tsx` lines ~543-561. Verify the notes-parts list matches exactly: filename + supplier + plate + fuel_type.

- [ ] **Step 4: Update `ExtractionReview.tsx`**

Add imports:
```ts
import { FuelReceiptFields } from '@renderer/components/extractions/fuel-receipt/fields';
import { buildFuelReceiptInitialValues } from '@renderer/components/extractions/fuel-receipt/prefill';
import type { FuelReceiptParsed } from '@renderer/components/extractions/fuel-receipt/types';
```

Delete inline: `type FuelReceiptParsed`, `function FuelReceiptFields`, `function buildFuelReceiptInitialValues`.

- [ ] **Step 5: Typecheck + vitest**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run --pool=threads 2>&1 | tail -10
```
381 tests passing.

- [ ] **Step 6: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/renderer/components/extractions/fuel-receipt/ src/renderer/components/ExtractionReview.tsx
git commit -m "refactor(ui): split fuel-receipt into extractions/fuel-receipt/{types,fields,prefill}"
git branch --show-current
```

---

## Task 4: Move freight — `extractions/freight/`

**Files:**
- Create: `src/renderer/components/extractions/freight/types.ts`
- Create: `src/renderer/components/extractions/freight/fields.tsx`
- Create: `src/renderer/components/extractions/freight/prefill.ts`
- Modify: `src/renderer/components/ExtractionReview.tsx`

- [ ] **Step 1: Create `types.ts`**

`src/renderer/components/extractions/freight/types.ts`:

```ts
export type FreightParsed = {
  doc_type?: string;
  supplier_name?: string;
  mode?: 'road' | 'rail' | 'sea' | 'air';
  vehicle_class?: string | null;
  weight_kg?: number;
  volume_m3?: number | null;
  distance_km?: number | null;
  origin?: string;
  destination?: string;
  tracking_no?: string | null;
  amount_yuan?: number;
  occurred_at?: string;
  confidence?: 'high' | 'medium' | 'low';
};
```

- [ ] **Step 2: Create `fields.tsx`**

`src/renderer/components/extractions/freight/fields.tsx`:

```tsx
import { Field } from '../shared';
import * as m from '@renderer/paraglide/messages';
import type { FreightParsed } from './types';

export function FreightFields({ data }: { data: FreightParsed }) {
  // body from ExtractionReview.tsx around lines 437-465 — copy verbatim
}
```

- [ ] **Step 3: Create `prefill.ts`**

`src/renderer/components/extractions/freight/prefill.ts`:

```ts
import type { ActivityFormInitialValues } from '@renderer/components/ActivityForm';
import type { FreightParsed } from './types';

export function buildFreightInitialValues(
  data: FreightParsed,
  filename: string,
): ActivityFormInitialValues {
  const notesParts = [`Auto-extracted from: ${filename}`];
  if (data.supplier_name) notesParts.push(`Supplier: ${data.supplier_name}`);
  if (data.origin || data.destination) {
    notesParts.push(`${data.origin ?? '?'} → ${data.destination ?? '?'}`);
  }
  if (data.mode) notesParts.push(`Mode: ${data.mode}`);
  if (data.tracking_no) notesParts.push(`Tracking: ${data.tracking_no}`);
  const out: ActivityFormInitialValues = {
    unit: 'kg',
    notes: notesParts.join(' · '),
  };
  if (data.occurred_at) {
    out.occurred_at_start = data.occurred_at;
    out.occurred_at_end = data.occurred_at;
  }
  if (typeof data.weight_kg === 'number') out.amount = String(data.weight_kg);
  return out;
}
```

Verify against the source at lines ~574-595. Body is unchanged; only the inline ActivityForm import is lifted.

- [ ] **Step 4: Update `ExtractionReview.tsx`**

Add imports:
```ts
import { FreightFields } from '@renderer/components/extractions/freight/fields';
import { buildFreightInitialValues } from '@renderer/components/extractions/freight/prefill';
import type { FreightParsed } from '@renderer/components/extractions/freight/types';
```

Delete inline: `type FreightParsed`, `function FreightFields`, `function buildFreightInitialValues`.

- [ ] **Step 5: Typecheck + vitest**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run --pool=threads 2>&1 | tail -10
```
381 tests passing.

- [ ] **Step 6: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/renderer/components/extractions/freight/ src/renderer/components/ExtractionReview.tsx
git commit -m "refactor(ui): split freight into extractions/freight/{types,fields,prefill}"
git branch --show-current
```

---

## Task 5: Move purchase — `extractions/purchase/`

**Files:**
- Create: `src/renderer/components/extractions/purchase/types.ts`
- Create: `src/renderer/components/extractions/purchase/fields.tsx`
- Create: `src/renderer/components/extractions/purchase/prefill.ts`
- Modify: `src/renderer/components/ExtractionReview.tsx`

- [ ] **Step 1: Create `types.ts`**

`src/renderer/components/extractions/purchase/types.ts`:

```ts
export type PurchaseParsed = {
  doc_type?: string;
  supplier_name?: string;
  item_description?: string;
  category?: 'raw_material' | 'component' | 'consumable' | 'office_supply' | 'service' | 'other';
  quantity_kg?: number | null;
  amount_yuan?: number;
  occurred_at?: string;
  invoice_no?: string | null;
  confidence?: 'high' | 'medium' | 'low';
};
```

- [ ] **Step 2: Create `fields.tsx`**

`src/renderer/components/extractions/purchase/fields.tsx`:

```tsx
import { Field } from '../shared';
import * as m from '@renderer/paraglide/messages';
import type { PurchaseParsed } from './types';

export function PurchaseFields({ data }: { data: PurchaseParsed }) {
  // body from ExtractionReview.tsx around lines 467-485 — copy verbatim
}
```

- [ ] **Step 3: Create `prefill.ts`**

`src/renderer/components/extractions/purchase/prefill.ts`:

```ts
import type { ActivityFormInitialValues } from '@renderer/components/ActivityForm';
import type { PurchaseParsed } from './types';

export function buildPurchaseInitialValues(
  data: PurchaseParsed,
  filename: string,
): ActivityFormInitialValues {
  const notesParts = [`Auto-extracted from: ${filename}`];
  if (data.supplier_name) notesParts.push(`Supplier: ${data.supplier_name}`);
  if (data.item_description) notesParts.push(`Items: ${data.item_description}`);
  if (data.category) notesParts.push(`Category: ${data.category}`);
  if (data.invoice_no) notesParts.push(`Invoice: ${data.invoice_no}`);

  const hasWeight = typeof data.quantity_kg === 'number' && data.quantity_kg > 0;
  const out: ActivityFormInitialValues = {
    unit: hasWeight ? 'kg' : 'CNY',
    notes: notesParts.join(' · '),
  };
  if (data.occurred_at) {
    out.occurred_at_start = data.occurred_at;
    out.occurred_at_end = data.occurred_at;
  }
  if (hasWeight) {
    out.amount = String(data.quantity_kg);
  } else if (typeof data.amount_yuan === 'number') {
    out.amount = String(data.amount_yuan);
  }
  return out;
}
```

- [ ] **Step 4: Update `ExtractionReview.tsx`**

Add imports:
```ts
import { PurchaseFields } from '@renderer/components/extractions/purchase/fields';
import { buildPurchaseInitialValues } from '@renderer/components/extractions/purchase/prefill';
import type { PurchaseParsed } from '@renderer/components/extractions/purchase/types';
```

Delete inline: `type PurchaseParsed`, `function PurchaseFields`, `function buildPurchaseInitialValues`.

- [ ] **Step 5: Typecheck + vitest**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run --pool=threads 2>&1 | tail -10
```
381 tests passing.

- [ ] **Step 6: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/renderer/components/extractions/purchase/ src/renderer/components/ExtractionReview.tsx
git commit -m "refactor(ui): split purchase into extractions/purchase/{types,fields,prefill}"
git branch --show-current
```

---

## Task 6: Move travel — `extractions/travel/`

**Files:**
- Create: `src/renderer/components/extractions/travel/types.ts`
- Create: `src/renderer/components/extractions/travel/fields.tsx`
- Create: `src/renderer/components/extractions/travel/prefill.ts`
- Modify: `src/renderer/components/ExtractionReview.tsx`

- [ ] **Step 1: Create `types.ts`**

`src/renderer/components/extractions/travel/types.ts`:

```ts
export type TravelParsed = {
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

- [ ] **Step 2: Create `fields.tsx`**

`src/renderer/components/extractions/travel/fields.tsx`:

```tsx
import { Field } from '../shared';
import * as m from '@renderer/paraglide/messages';
import type { TravelParsed } from './types';

export function TravelFields({ data }: { data: TravelParsed }) {
  // body from ExtractionReview.tsx around lines 487-522 — copy verbatim
}
```

- [ ] **Step 3: Create `prefill.ts`**

`src/renderer/components/extractions/travel/prefill.ts`:

```ts
import type { ActivityFormInitialValues } from '@renderer/components/ActivityForm';
import type { TravelParsed } from './types';

export function buildTravelInitialValues(
  data: TravelParsed,
  filename: string,
): ActivityFormInitialValues {
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
  const out: ActivityFormInitialValues = {
    unit,
    notes: notesParts.join(' · '),
  };
  if (data.departure_at) {
    const datePart = data.departure_at.split('T')[0] ?? data.departure_at;
    out.occurred_at_start = datePart;
    out.occurred_at_end = datePart;
  }
  out.amount = typeof data.distance_km === 'number' ? String(data.distance_km) : '1';
  return out;
}
```

- [ ] **Step 4: Update `ExtractionReview.tsx`**

Add imports:
```ts
import { TravelFields } from '@renderer/components/extractions/travel/fields';
import { buildTravelInitialValues } from '@renderer/components/extractions/travel/prefill';
import type { TravelParsed } from '@renderer/components/extractions/travel/types';
```

Delete inline: `type TravelParsed`, `function TravelFields`, `function buildTravelInitialValues`.

- [ ] **Step 5: Typecheck + vitest**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run --pool=threads 2>&1 | tail -10
```
381 tests passing.

- [ ] **Step 6: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/renderer/components/extractions/travel/ src/renderer/components/ExtractionReview.tsx
git commit -m "refactor(ui): split travel into extractions/travel/{types,fields,prefill}"
git branch --show-current
```

---

## Task 7: Extract the discriminated union + final sweep — `extractions/types.ts`

After Tasks 1-6, `ExtractionReview.tsx` still holds the `StageParsed` union and the `parseExtraction` dispatcher inline (referencing the 5 per-stage `*Parsed` types via imports). This task moves the union + parser into `extractions/types.ts`, completing the split.

**Files:**
- Create: `src/renderer/components/extractions/types.ts`
- Modify: `src/renderer/components/ExtractionReview.tsx` (drop the 5 `import type { *Parsed }` imports, drop the inline union + parseExtraction, add ONE import from `./extractions/types`)
- Optionally modify: lint + format sweep on changed files

- [ ] **Step 1: Create `extractions/types.ts`**

`src/renderer/components/extractions/types.ts`:

```ts
import type { ChinaUtilityParsed } from './china-utility/types';
import type { FreightParsed } from './freight/types';
import type { FuelReceiptParsed } from './fuel-receipt/types';
import type { PurchaseParsed } from './purchase/types';
import type { TravelParsed } from './travel/types';

/**
 * Discriminated union over the 5 stage-version-specific parsed types.
 * The `stage` tag matches `Extraction.prompt_version` exactly so the
 * orchestrator can switch on it without re-parsing.
 */
export type StageParsed =
  | { stage: 'china_utility.v1'; data: ChinaUtilityParsed }
  | { stage: 'fuel_receipt.v1'; data: FuelReceiptParsed }
  | { stage: 'freight.v1'; data: FreightParsed }
  | { stage: 'purchase.v1'; data: PurchaseParsed }
  | { stage: 'travel.v1'; data: TravelParsed };

/**
 * Parse persisted extraction JSON for a known stage. Returns `null` for
 * malformed JSON or an unknown promptVersion. The discriminator is the
 * persisted prompt_version, not anything inside parsed_json itself.
 */
export function parseExtraction(
  raw: string | null,
  promptVersion: string,
): StageParsed | null {
  if (!raw) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  if (promptVersion === 'china_utility.v1') {
    return { stage: 'china_utility.v1', data: obj as ChinaUtilityParsed };
  }
  if (promptVersion === 'fuel_receipt.v1') {
    return { stage: 'fuel_receipt.v1', data: obj as FuelReceiptParsed };
  }
  if (promptVersion === 'freight.v1') {
    return { stage: 'freight.v1', data: obj as FreightParsed };
  }
  if (promptVersion === 'purchase.v1') {
    return { stage: 'purchase.v1', data: obj as PurchaseParsed };
  }
  if (promptVersion === 'travel.v1') {
    return { stage: 'travel.v1', data: obj as TravelParsed };
  }
  return null;
}
```

- [ ] **Step 2: Update `ExtractionReview.tsx`**

1. Remove the 5 `import type { *Parsed }` lines added in Tasks 2-6 (the per-stage type imports are no longer needed in the orchestrator — `parseExtraction` returns a `StageParsed` union and the JSX switch narrows on `parsed.stage`).
2. Add ONE import:
   ```ts
   import { parseExtraction } from '@renderer/components/extractions/types';
   ```
3. Delete the inline `type StageParsed = ...` block.
4. Delete the inline `function parseExtraction(...) { ... }` block.
5. Delete the now-unused divider comments (`// Per-stage parsed types + parsers`).

After this step, `ExtractionReview.tsx` should have ZERO inline type declarations and ZERO inline helper functions related to per-stage rendering — only the imports + `ExtractionReviewProps` + the `ExtractionReview` main component body remain.

- [ ] **Step 3: Verify LOC**

```bash
cd /Users/lxz/ws/personal/carbonbook
wc -l src/renderer/components/ExtractionReview.tsx
```
Expected: ~260-280 LOC (down from 698).

- [ ] **Step 4: Run typecheck**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
```
Expected: clean.

- [ ] **Step 5: Run vitest**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -10
```
Expected: 381 tests passing.

- [ ] **Step 6: Lint + format sweep**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm format
pnpm lint --max-diagnostics=80 2>&1 | tail -10
```
Expected: format may rewrite some files; lint shows 0 errors and only the pre-existing `noNonNullAssertion` warnings (27 prior). If lint reports a fixable `assist/source/organizeImports` error, fix it by hand (swap import order to alphabetical) — the new per-stage files often trip this.

- [ ] **Step 7: Commit the cross-stage glue**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/renderer/components/extractions/types.ts src/renderer/components/ExtractionReview.tsx
git commit -m "refactor(ui): move StageParsed union + parseExtraction to extractions/types"
```

- [ ] **Step 8: Commit any format/lint sweep changes (if any)**

```bash
cd /Users/lxz/ws/personal/carbonbook
git status
```

If there are uncommitted format/lint fixes (likely whitespace-only or import-order rewrites on the new files):
```bash
git add -A
git commit -m "chore: biome format pass for per-stage component split"
```

If `git status` shows no changes, skip this step.

- [ ] **Step 9: Verify branch state**

```bash
cd /Users/lxz/ws/personal/carbonbook
git branch --show-current
git log --oneline -10
```
Expected: `main` (not detached). The last 7-8 commits should be the per-stage split tasks.

If `git branch --show-current` returns empty:
```bash
git checkout -B main
```

---

## Closeout

Sub-project 4.5 of 5 (per-stage component split) lands on `main` with NO tag.

**Expected end state:**

- `src/renderer/components/ExtractionReview.tsx` at ~260-280 LOC (down from 698).
- `src/renderer/components/extractions/` directory with the 18-file layout:
  ```
  extractions/
  ├── types.ts                  (StageParsed + parseExtraction)
  ├── shared.tsx                (Field + CONFIDENCE_*)
  ├── china-utility/{types.ts, fields.tsx, prefill.ts}
  ├── fuel-receipt/{types.ts, fields.tsx, prefill.ts}
  ├── freight/{types.ts, fields.tsx, prefill.ts}
  ├── purchase/{types.ts, fields.tsx, prefill.ts}
  └── travel/{types.ts, fields.tsx, prefill.ts}
  ```
- 381 vitest tests passing (unchanged count — no new tests added).
- `pnpm typecheck` clean.
- `pnpm lint --max-diagnostics=80` shows 0 errors; only the 27 pre-existing `noNonNullAssertion` warnings.
- 7 commits landed (Tasks 1-7), optionally an 8th `chore: format pass` if the sweep produced one.
- `git branch --show-current` returns `main`.

**Next sub-project:** EF Matcher v1 (sub-project 5 of 5 — final Phase 1 deliverable). After that lands, consolidated manual smoke + `phase-1d` tag.
