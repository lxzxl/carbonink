# EF Rebind UI — Design

**Date:** 2026-05-20
**Status:** Approved (brainstorming complete; ready for plan)
**Sub-project:** Phase 3 / sub-project 2 of 4
**Prior sub-projects shipped:** Phase 0/1/2 (full); Phase 3 sub-project 1 (ISO 14064-1 inventory report — `4f80184`). 580 vitest tests passing on `main`.

---

## 1. Goal

Let the user rebind the pinned `emission_factor` on an existing `activity_data` row from a drawer triggered off the Activities list. The drawer reuses the EF picker from `ActivityForm`, supports same-family unit conversion, displays a before/after CO2e delta, and writes a row to `audit_event` capturing the change.

**Problem:** EF Matcher v1 occasionally pins the wrong EF. The pinned EF on `activity_data` is currently immutable; the user's only recovery is to delete and re-create the activity, losing extraction provenance.

**Scope (v1):**

- "重新镶嵌" button on every row in the Activities list (`/activities`).
- Drawer with: current EF (read-only), shared EF picker (Recommended + Browse), unit-conversion preview, before/after CO2e delta, Confirm/Cancel.
- Same-family unit conversion via `unit-conversion-service.convert()`. UI shows the conversion explicitly.
- Cross-family unit mismatch disables Confirm with an inline reason.
- On Confirm: transactional UPDATE of `activity_data` + INSERT into `audit_event` (event_kind = `activity_rebind_ef`, JSON payload captures before/after).
- Renderer invalidates affected TanStack Query keys; toast confirms with delta.

**Out of scope:**

- Batch rebind ("rebind all X → Y").
- Editing amount / unit / period / source on an activity.
- Cross-family unit conversion (requires fuel-code binding, deferred).
- Per-rebind "reason" field on the audit payload.
- Multiple entry points beyond the Activities list.
- Audit-event viewer UI (separate sub-project 4 of Phase 3).
- New schema columns (audit_event + activity_data already have everything needed).

---

## 2. Architecture & Data Flow

```
[Activities list: <ActivityRow /> ← new "重新镶嵌" button]
                       │
                       ▼
[<RebindEfDrawer activityId={id}>]
   ├─ TanStack Query: invoke('activity:get-by-id', { id })
   │      → returns ActivityDataWithEf (activity + resolved pinned_ef)
   ├─ <EfPicker> — extracted from ActivityForm (shared component)
   ├─ Client-side preview delta:
   │     if activity.unit === newEf.input_unit:
   │       newAmount = activity.amount
   │     else if same-family:
   │       newAmount = unitConversionService.convert(activity.amount, activity.unit, newEf.input_unit)
   │     else:
   │       crossFamilyMismatch = true; Confirm disabled
   │     newCo2e = newAmount × newEf.co2e_kg_per_unit
   ├─ Confirm button → mutation invoke('activity:rebind-ef', { activity_id, new_ef_pk })
   └─ On success → toast (delta) + invalidate ['activity:list-by-period', …]

[Main: activity:rebind-ef handler]
                       │
                       ▼
[ActivityDataService.rebindEf]
   1. Load activity_data row (NotFound if missing)
   2. Look up new EF in emission_factor (EfNotFound if missing)
   3. If unit differs: try unitConversionService.convert; on throw → UnitMismatch
   4. new_co2e_kg = newAmount × newEf.co2e_kg_per_unit
   5. db.transaction:
        - UPDATE activity_data SET ef_factor_code = ?, ef_year = ?, ef_source = ?,
            ef_geography = ?, ef_dataset_version = ?, amount = ?, unit = ?,
            computed_co2e_kg = ?, computed_at = ?, updated_at = ? WHERE id = ?
        - upsert into pinned_emission_factor (composite PK; INSERT OR IGNORE matches existing pin pattern)
        - INSERT INTO audit_event (ulid, 'activity_rebind_ef', json_payload, now())
   6. Return { ok: true, updated, old_co2e_kg, new_co2e_kg }
```

### Component responsibilities

| File | Responsibility |
|---|---|
| `src/main/services/activity-data-service.ts` | Add `rebindEf({ activity_id, new_ef_pk })`. Transaction: UPDATE activity_data + upsert pinned_ef + INSERT audit_event. Returns delta or typed error. |
| `src/main/services/activity-data-service.ts` | Add `getByIdWithEf(id)` that joins activity_data with its current pinned_emission_factor row. Used by `activity:get-by-id`. |
| `src/main/ipc/handlers/activity-data.ts` | Add `activity:get-by-id` and `activity:rebind-ef` handlers. Thin glue around the service. |
| `src/main/ipc/types.ts` | New entries in IpcTypeMap. |
| `src/preload/bridge.ts` | Allowlist 2 new channels. |
| `tests/preload/bridge.test.ts` | Allowlist assertion extended. |
| `src/renderer/lib/api/activity-data.ts` (or wherever the existing renderer activity-data API lives — confirm at implementation time) | Add `getById` + `rebindEf`. |
| `src/renderer/components/EfPicker.tsx` | NEW. Extracted from `ActivityForm.tsx`. The 2-pane Recommended + Browse picker. Accepts `currentEfPk` (preselects), `matcherHint` (drives Recommended pane), `onChange(efPk)`. |
| `src/renderer/components/ActivityForm.tsx` | Refactored to use `<EfPicker>`. No behavior change. |
| `src/renderer/components/RebindEfDrawer.tsx` | NEW. The drawer. Owns: open state, current-activity query, picker selection, client-side preview, mutation. |
| `src/renderer/routes/activities.tsx` | Add "重新镶嵌" button on each row + drawer open/close state. |
| `messages/en.json`, `messages/zh-CN.json` | ~10 new i18n keys. |

### Why service-layer audit (not trigger)

`audit_event` already exists (migration 006) but has no triggers on `activity_data`. A SQLite trigger could capture row-level before/after but cannot easily compose structured JSON payloads like `{ old_ef, new_ef, old_co2e_kg, new_co2e_kg }`. The service-layer write is more flexible and matches the existing carbonbook pattern (Phase 1+2 services already write audit_events explicitly for confirm / discard flows — same precedent).

### Why extract `<EfPicker>`

`ActivityForm.tsx` currently has the 2-pane picker (Recommended panel from EF Matcher + Browse panel against the EF library) embedded inside it. The RebindEfDrawer needs the same picker. Extracting it now is cleaner than copy-pasting and is a targeted refactor (no behavior change in ActivityForm). Tested by pre-existing ActivityForm tests + new RebindEfDrawer tests.

---

## 3. API Contracts

### New IPC channels (`IpcTypeMap`)

```ts
'activity:get-by-id': (input: { id: string }) => Promise<ActivityDataWithEf | null>;

'activity:rebind-ef': (input: {
  activity_id: string;
  new_ef_pk: EfCompositePk;
}) => Promise<
  | {
      ok: true;
      updated: ActivityData;
      old_co2e_kg: number;
      new_co2e_kg: number;
      old_amount: number;
      old_unit: string;
      new_amount: number;
      new_unit: string;
    }
  | { ok: false; error: { _tag: 'NotFound' | 'EfNotFound' | 'UnitMismatch'; message: string } }
>;
```

### Shared type addition (`src/shared/types.ts`)

```ts
/** ActivityData row joined with the currently pinned emission factor. */
export type ActivityDataWithEf = ActivityData & {
  pinned_ef: PinnedEmissionFactor;
};
```

### audit_event.payload JSON shape

```json
{
  "activity_id": "act_...",
  "old_ef": { "factor_code": "diesel_L", "year": 2024, "source": "MEE", "geography": "CN", "dataset_version": "2024.1" },
  "new_ef": { "factor_code": "diesel_kg", "year": 2025, "source": "IPCC", "geography": "CN", "dataset_version": "2025.1" },
  "old_amount": 1000,
  "old_unit": "L",
  "old_computed_co2e_kg": 2680,
  "new_amount": 800,
  "new_unit": "kg",
  "new_computed_co2e_kg": 2540
}
```

`event_kind` = `"activity_rebind_ef"`. `occurred_at` = ISO timestamp at the moment of the UPDATE.

---

## 4. UI Behavior

### Activities list (`/activities`) row

```
Site │ Source │ Period │ Amount Unit │ EF │ CO2e │ [重新镶嵌]
```

The button is enabled for every activity (no permission gate in v1).

### RebindEfDrawer

Layout:

1. **Header**: "重新镶嵌排放因子" / "Rebind emission factor"
2. **Current activity block** (read-only):
   - Source name · Site · Period · `<amount> <unit>`
   - Current EF: `<factor_code>` @ `<source>` `<year>` `<geography>`
   - Current emissions: `<computed_co2e_kg>` kg CO2e
3. **EF picker** (`<EfPicker>`): Recommended + Browse tabs. Preselects the current EF so the user can A/B compare easily.
4. **Preview block** — appears when a new EF is selected AND is different from current:
   - Unit conversion line (only if `activity.unit !== newEf.input_unit`):
     - Same-family: "单位换算: 1,000 L → 800 kg" / "Unit conversion: 1,000 L → 800 kg"
     - Cross-family: red text "无法跨单位族自动换算 (L → kWh): 请删除并重建该活动" + Confirm disabled
   - New emissions: `<new_co2e_kg>` kg CO2e
   - Delta: `<signed_delta>` kg (`<signed_pct>%`) — green if negative, amber if positive ≥10%
5. **Footer**: [取消 / Cancel] [确认重新镶嵌 / Confirm rebind]

On Confirm success: toast `已重新镶嵌 — 新排放 <new_co2e_kg> kg CO2e (<signed_pct>%)`, drawer closes, TanStack Query invalidates `['activity:list-by-period']` + `['activity:totals-by-period']`.

On Confirm error: toast with the typed error's message; drawer stays open.

---

## 5. Error Handling

| Failure | Where surfaced | Behavior |
|---|---|---|
| Activity not found | `activity:rebind-ef` returns `NotFound` | Toast error; drawer stays open |
| New EF composite PK doesn't exist | `EfNotFound` | Toast error; drawer stays open |
| Cross-family unit (e.g. L → kWh) | `UnitMismatch` (server-side last-line check); also detected client-side and disables Confirm | Toast + inline drawer text; UPDATE never reaches the DB |
| Same-family unit conversion edge case (e.g. amount is 0 / negative) | `convert()` returns a numeric (0 stays 0); no special handling | Goes through; user sees `0 kg CO2e` (which is correct) |
| Concurrent modification | better-sqlite3 is single-writer; not a concern | — |

The handler always returns `{ ok: true } | { ok: false, error }` — no throws across IPC. The service layer can throw internally (caught by the handler) so the service signature is straightforward.

---

## 6. Testing Strategy

### Unit (vitest) — target ~8 new tests

**`tests/main/services/activity-data-service.test.ts`** — 5 new tests on `rebindEf`:
1. Same-unit rebind: computed_co2e_kg recomputed; audit_event row created with correct old/new payload.
2. Same-family unit conversion (e.g. amount 1000 L, new EF in kg with density-implied conversion table): amount converted, co2e_kg uses converted amount.
3. Cross-family unit (e.g. L → kWh): returns `UnitMismatch`; activity_data row unchanged; no audit_event written.
4. Activity not found: returns `NotFound`.
5. New EF composite PK not in `emission_factor`: returns `EfNotFound`.

**`tests/main/services/activity-data-service.test.ts`** — 1 test on `getByIdWithEf`:
6. Returns the activity joined with its pinned_ef; returns null for unknown id.

**`tests/main/ipc/activity-data-handlers.test.ts`** (or wherever) — 2 tests for the new channels:
7. `activity:rebind-ef` passes through to service.rebindEf and returns the typed result.
8. `activity:get-by-id` passes through to service.getByIdWithEf.

### Renderer (vitest + happy-dom) — target ~2 new tests

**`tests/renderer/rebind-drawer.test.tsx`**:
9. Renders current EF + delta preview when a new EF is selected.
10. Confirm button disabled (with cross-family message visible) when picker selects an EF whose input_unit is cross-family from the activity's unit.

**`tests/preload/bridge.test.ts`** — extend allowlist assertion (no new test count).

### Out of scope (deliberately)

- E2E spec for rebind — deferred to consolidated phase-3 tag-time smoke.
- Snapshot of the full Activities list with the new button — UI snapshot tests have proven brittle in this codebase.

**Test count target:** 580 → ~590 (+10).

---

## 7. Dependencies

- No new top-level dependencies.
- Reuses: `unit-conversion-service`, `audit_event` table (migration 006), existing `ActivityForm` picker (extracted), TanStack Query, paraglide i18n, vitest.

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Extracting `<EfPicker>` from ActivityForm subtly breaks ActivityForm | Targeted refactor with no behavior change; pre-existing ActivityForm tests verify; if any test fails, that's the signal to revert the refactor and inline the picker in RebindEfDrawer instead |
| Same-family conversion uses wrong density (e.g. L→kg for fuel) | `unit-conversion-service` already maintains conversion tables; if the conversion is "ambiguous without fuel binding" the service throws → we catch as UnitMismatch (correct conservative behavior) |
| audit_event UI doesn't exist yet (no way to view the log) | sub-project 4 of Phase 3 will surface audit_event via UI; the rebind audit is the first dataset that UI will display |
| User confused by "before/after" delta sign | UI shows signed value (`-140 kg`, green) and percent (`-5.2%`); plain-language toast |

---

## 9. Acceptance

- `pnpm test` passes 590+ tests (580 baseline + ~10 new).
- `pnpm typecheck` clean.
- `biome check` clean (no NEW errors — pre-existing baseline errors unchanged).
- A user can: navigate to `/activities`, click "重新镶嵌" on any row, see the drawer with current EF + picker + preview, pick a different EF, see the delta, click Confirm, see the toast, see the row update (CO2e + EF name), and (in a future sub-project) see the change in audit_event.

---

## 10. Future v1.5+

- Batch rebind ("rebind all activities using EF X to EF Y") — would surface in a `/activities/rebind` route or as a multi-select on the list.
- Cross-family conversion via fuel-code binding (requires the user to tell the system which fuel the activity is, then `unitConversionService.convertWithFuel` handles L↔kWh via density + LHV).
- "Reason" field on audit payload (free text).
- Multiple entry points (extraction review page, dashboard).
- Undo from audit_event (would require the audit_event UI from sub-project 4).
