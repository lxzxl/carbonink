# Per-Stage Component Split Design

**Date:** 2026-05-14
**Sub-project:** 4.5 of Phase 1 (Phase 1.5 prep)
**Predecessor:** travel.v1 (sub-project 4) — `commit ce89ad0` on `main`
**Successor:** EF Matcher v1 (sub-project 5)

## Goal

Refactor `src/renderer/components/ExtractionReview.tsx` (currently 698 LOC, single file holding 5 stages' types, Fields renderers, and prefill builders) into per-stage component directories. The orchestrator file shrinks to ~270 LOC (imports + props + the 207-LOC main component body remain). **Behavior identical. No new features. No new tests.** This is preparation work that unblocks the EF Matcher v1 sub-project, which will need to add per-stage UI affordances (EF suggestions, routing-API distance fill) without further bloating a monolithic file.

## Non-goals

- Adding new features, fields, or stages.
- Renaming any existing export.
- Touching `ActivityForm.tsx`, `documents_.$id.tsx`, or any file in `src/main/`.
- Adding new tests. The refactor is mechanical; the existing safety net (typecheck + 4 renderer tests + 18 main-process schema tests + 5 extraction-service smokes) suffices.
- Optimizing the switch dispatcher in `parseExtraction` or the JSX ternary chain. They are correct; refactor preserves them.

## Current state (audited 2026-05-14, `commit ce89ad0`)

`src/renderer/components/ExtractionReview.tsx` — 698 LOC, single file. Lines (approximate):

| Lines | Concern |
|---|---|
| 1-50 | Imports + `ExtractionReviewProps` |
| 51-127 | 5 parsed types: `ChinaUtilityParsed`, `FuelReceiptParsed`, `FreightParsed`, `PurchaseParsed`, `TravelParsed` |
| 129-135 | `StageParsed` discriminated union |
| 136-170 | `parseExtraction(raw, version)` switch dispatcher |
| 171-186 | `CONFIDENCE_CLASSES` + `CONFIDENCE_LABELS` maps |
| 187-393 | `ExtractionReview` main component (~207 LOC) — layout, ActivityForm wiring, 5-arm switch |
| 394-523 | 5 `*Fields` subcomponents (~130 LOC) |
| 524-689 | 5 `build*InitialValues` functions (~166 LOC) |
| 690-697 | shared `Field` row helper |

Consumers: only `src/renderer/routes/documents_.$id.tsx` imports `ExtractionReview`.

## Target file structure

```
src/renderer/components/
├── ExtractionReview.tsx                  ← orchestrator (~150 LOC)
└── extractions/
    ├── types.ts                          ← StageParsed union + parseExtraction()
    ├── shared.tsx                        ← Field + CONFIDENCE_CLASSES + CONFIDENCE_LABELS
    ├── china-utility/
    │   ├── types.ts                      ← ChinaUtilityParsed
    │   ├── fields.tsx                    ← ChinaUtilityFields
    │   └── prefill.ts                    ← buildChinaUtilityInitialValues
    ├── fuel-receipt/
    │   ├── types.ts                      ← FuelReceiptParsed
    │   ├── fields.tsx                    ← FuelReceiptFields
    │   └── prefill.ts                    ← buildFuelReceiptInitialValues
    ├── freight/
    │   ├── types.ts                      ← FreightParsed
    │   ├── fields.tsx                    ← FreightFields
    │   └── prefill.ts                    ← buildFreightInitialValues
    ├── purchase/
    │   ├── types.ts                      ← PurchaseParsed
    │   ├── fields.tsx                    ← PurchaseFields
    │   └── prefill.ts                    ← buildPurchaseInitialValues
    └── travel/
        ├── types.ts                      ← TravelParsed
        ├── fields.tsx                    ← TravelFields
        └── prefill.ts                    ← buildTravelInitialValues
```

**Total:** 1 orchestrator + 2 cross-stage files + 15 per-stage files = 18 files (up from 1).

Folder names mirror `src/main/llm/stages/<stage>.ts` (hyphenated, no `.v1` suffix). This intentional symmetry makes "the renderer side of `freight`" trivial to find by analogy.

## Per-stage contract

Each `extractions/<stage>/` folder exports exactly three names, each in a dedicated file. The shape is identical across all 5 stages; only the type differs.

**`extractions/<stage>/types.ts`** — pure types, no runtime deps:
```ts
export type <Stage>Parsed = {
  // ... existing shape, copied verbatim from ExtractionReview.tsx
};
```

**`extractions/<stage>/fields.tsx`** — pure presentation:
```ts
import { Field } from '../shared';
import { m } from '@renderer/paraglide/messages';
import type { <Stage>Parsed } from './types';

export function <Stage>Fields({ data }: { data: <Stage>Parsed }) {
  return (
    <>
      <Field label={m.field_label()} value={data.field} />
      {/* ... existing rows, copied verbatim */}
    </>
  );
}
```

**`extractions/<stage>/prefill.ts`** — pure data mapping, no React deps:
```ts
import type { <Stage>Parsed } from './types';
import type { ActivityFormInitialValues } from '@renderer/components/ActivityForm';

export function build<Stage>InitialValues(
  data: <Stage>Parsed,
  filename: string,
): ActivityFormInitialValues {
  return {
    // ... existing mapping, copied verbatim
  };
}
```

If any of the existing inline functions imports additional symbols (e.g., `dayjs`, paraglide messages, helper utilities), the move carries those imports with it. The implementer audits each function's references before moving.

## Cross-stage glue

### `extractions/types.ts`

Owns the discriminated union and the `parseExtraction` dispatcher. The `kind` tag uses stage-version strings (matches the existing pattern in the monolithic file):

```ts
import type { ChinaUtilityParsed } from './china-utility/types';
import type { FreightParsed } from './freight/types';
import type { FuelReceiptParsed } from './fuel-receipt/types';
import type { PurchaseParsed } from './purchase/types';
import type { TravelParsed } from './travel/types';

export type StageParsed =
  | { kind: 'china_utility.v1'; data: ChinaUtilityParsed }
  | { kind: 'fuel_receipt.v1'; data: FuelReceiptParsed }
  | { kind: 'freight.v1'; data: FreightParsed }
  | { kind: 'purchase.v1'; data: PurchaseParsed }
  | { kind: 'travel.v1'; data: TravelParsed };

export function parseExtraction(
  raw: string | null,
  promptVersion: string,
): StageParsed | null {
  // existing switch body, copied verbatim
}
```

### `extractions/shared.tsx`

Owns the `Field` row helper and the two confidence maps. `Field` is consumed by all 5 `fields.tsx` files; the confidence maps are consumed only by the orchestrator (`ExtractionReview.tsx`), but they live here because they're cross-stage concerns and keeping them with `Field` avoids a separate one-purpose file.

```ts
export function Field({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  // existing body, copied verbatim
}

export const CONFIDENCE_CLASSES: Record<'high' | 'medium' | 'low', string> = {
  // existing map, copied verbatim
};

export const CONFIDENCE_LABELS: Record<'high' | 'medium' | 'low', () => string> = {
  // existing map, copied verbatim
};
```

## Resulting `ExtractionReview.tsx`

After the split, the orchestrator imports from per-stage folders + the two glue files. Its responsibility narrows to: layout shell, parseExtraction call site, confidence badge, 5-arm Fields switch, ActivityForm trigger + initial-values switch, discard/confirm wiring.

```ts
import { ChinaUtilityFields } from './extractions/china-utility/fields';
import { buildChinaUtilityInitialValues } from './extractions/china-utility/prefill';
import { FreightFields } from './extractions/freight/fields';
import { buildFreightInitialValues } from './extractions/freight/prefill';
import { FuelReceiptFields } from './extractions/fuel-receipt/fields';
import { buildFuelReceiptInitialValues } from './extractions/fuel-receipt/prefill';
import { PurchaseFields } from './extractions/purchase/fields';
import { buildPurchaseInitialValues } from './extractions/purchase/prefill';
import { TravelFields } from './extractions/travel/fields';
import { buildTravelInitialValues } from './extractions/travel/prefill';
import { CONFIDENCE_CLASSES, CONFIDENCE_LABELS } from './extractions/shared';
import { parseExtraction } from './extractions/types';

// ExtractionReviewProps + ExtractionReview function body (existing, unchanged)
```

Expected post-split LOC: ~260-280. The 207-LOC main component body is unchanged (only the inline type/Fields/prefill definitions move out); imports + Props (~50 LOC) plus 12 new per-stage imports remain on the orchestrator.

## Migration order

Each task moves one logical chunk and runs the full test suite green before committing. Tests stay green at every step because:
- The orchestrator's imports update atomically with each move (one file edited per task).
- The shape of every moved symbol is preserved exactly.
- Typecheck enforces the discriminated union after each step.

| Task | Move | LOC delta on ExtractionReview.tsx |
|---|---|---|
| 1 | Create `extractions/shared.tsx` — move `Field`, `CONFIDENCE_CLASSES`, `CONFIDENCE_LABELS` | -24 |
| 2 | Create `extractions/china-utility/{types,fields,prefill}` — move ChinaUtilityParsed + ChinaUtilityFields + buildChinaUtilityInitialValues | -49 |
| 3 | Create `extractions/fuel-receipt/{types,fields,prefill}` — move FuelReceiptParsed + FuelReceiptFields + buildFuelReceiptInitialValues | -76 |
| 4 | Create `extractions/freight/{types,fields,prefill}` — move FreightParsed + FreightFields + buildFreightInitialValues | -84 |
| 5 | Create `extractions/purchase/{types,fields,prefill}` — move PurchaseParsed + PurchaseFields + buildPurchaseInitialValues | -75 |
| 6 | Create `extractions/travel/{types,fields,prefill}` — move TravelParsed + TravelFields + buildTravelInitialValues | -90 |
| 7 | Create `extractions/types.ts` — move StageParsed union + parseExtraction; thin orchestrator's imports; lint + format sweep | -42 |

Cumulative: ~698 → ~270 LOC on ExtractionReview.tsx (440 LOC moved out, ~12 new per-stage imports added back).

**Why this order:** shared helpers first (so per-stage files have a target to import from). Then stages in the order they were added historically (china_utility → fuel_receipt → freight → purchase → travel), each independent. The cross-stage `types.ts` lands last because it depends on all 5 per-stage `types.ts` files existing.

**Bridge state during tasks 2-6:** the monolithic `StageParsed` union and `parseExtraction` dispatcher remain inline on the orchestrator throughout, importing the per-stage types from their new homes. This keeps each task small (one stage's move) and the orchestrator continuously green.

## Risk + safety net

| Risk | Caught by |
|---|---|
| Discriminated union arms drift (e.g., a `kind` typo) | `pnpm typecheck` — every step. |
| `Field` row label/value rendering regression | `tests/renderer/documents-review.test.tsx` (renders china_utility extraction, asserts field text). |
| Orchestrator routing regression (wrong stage's prefill on confirm) | `tests/renderer/documents-review.test.tsx` "Confirm button opens the embedded ActivityForm with prefilled values" — exercises the prefill switch for china_utility's path. |
| Stage-specific extraction routing regression | 5 extraction-service smoke tests in `tests/main/services/extraction-service.test.ts`. |
| Schema regression in any stage | 18 main-process tests (one suite per stage). |
| Discard / empty-state regression | `tests/renderer/documents-review.test.tsx` "Discard button" + "shows the no-extraction message" tests. |

**Gap:** per-stage Fields rendering (fuel_receipt, freight, purchase, travel) and per-stage `build*InitialValues` are not exercised by renderer tests. Typecheck catches type-level breaks; visual/runtime breaks would not be caught at the test layer. Mitigation: the consolidated manual smoke before the `phase-1d` tag covers every stage's end-to-end happy path, including the per-stage Fields render and prefill. This is consistent with how the prior 4 stages' renderer paths shipped.

## Expected end state

- `src/renderer/components/ExtractionReview.tsx` at ~270 LOC (down from 698).
- `src/renderer/components/extractions/` exists with the 18-file layout described above.
- All 381 vitest tests passing, unchanged count.
- `pnpm typecheck` clean.
- `pnpm lint --max-diagnostics=80` shows 0 errors, only the pre-existing `noNonNullAssertion` warnings.
- `git branch --show-current` returns `main`.
- 7 commits landed; no tag (phase-1d tag reserved for after sub-project 5).

## Out-of-scope follow-ups (recorded for future sub-projects)

- A barrel `extractions/index.ts` for ergonomic re-exports — only worth adding if a second consumer beyond `ExtractionReview.tsx` appears.
- Per-stage renderer tests filling the Fields/prefill coverage gap — appropriate to add as part of EF Matcher v1 when those code paths grow new affordances.
- Co-locating each per-stage folder's i18n keys — currently i18n keys are in a flat `messages/en.json` / `messages/zh-CN.json`; per-folder slicing would require paraglide config changes beyond this refactor's scope.
