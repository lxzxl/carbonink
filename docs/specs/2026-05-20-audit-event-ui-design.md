# Audit Event UI — Design

**Date:** 2026-05-20
**Status:** Approved (brainstorming complete; ready for plan)
**Sub-project:** Phase 3 / sub-project 3 of 4 (reordered)
**Prior shipped:** Phase 0/1/2 full + Phase 3 sub-projects 1 (ISO 14064-1 report) and 2 (EF rebind UI). 595 vitest tests passing on `main`.

---

## 1. Goal

Add a `/audit` route in the renderer that displays rows from the `audit_event` table (migration 006) with chronological listing, event-kind filter, date-range filter, and per-kind pretty rendering. v1 has exactly one pretty renderer (`activity_rebind_ef` — the only event_kind currently produced) plus a raw-JSON fallback for any future event_kinds.

**Problem:** sub-project 2 (EF rebind UI) writes structured rows to `audit_event` capturing every EF rebind, but no UI surfaces them. Users have no way to review the audit trail of what changed.

**Scope (v1):**

- New `/audit` route in sidebar with i18n nav label.
- Reverse-chronological list (newest first).
- Pretty card renderer for `activity_rebind_ef`.
- Raw-JSON fallback card for unknown event_kinds.
- Filter dropdown for `event_kind` (multi-select).
- Date-range picker (default: last 30 days).
- Cap initial query to 500 most-recent rows after filtering. "Load older" button extends in 500-row chunks.
- Empty-state message when no events match filters.

**Out of scope (v1):**

- Retrofitting existing services (extraction-service, answer-generation, questionnaire-service) to emit audit events. Future incremental.
- Per-entity drill-in (e.g. "show all audit events for activity X" from the Activities list). Deferred to v1.5.
- Full-text search of payload JSON. Use event_kind + date filter instead.
- MCP integration (`list_audit_events` tool). YAGNI.
- Undo / revert actions from the audit UI.
- Export of audit log (CSV/PDF).

---

## 2. Architecture

```
[Sidebar: 审计日志 / Audit log]
                   │
                   ▼
[/audit route]
   ├─ TanStack Query: invoke('audit:list', { event_kinds, since, until, limit })
   ├─ Filter controls (event-kind multi-select + date-range picker)
   ├─ <AuditEventCard event={row}> per row
   │       └─ Dispatches to <ActivityRebindCard> when event_kind === 'activity_rebind_ef'
   │       └─ Otherwise <RawJsonCard> with formatted JSON
   └─ "Load older" button → re-queries with next limit / older `until`
```

### Component responsibilities

| File | Responsibility |
|---|---|
| `src/main/services/audit-event-service.ts` | NEW. Single method `list({ event_kinds?, since?, until?, limit })` returning `AuditEvent[]`. No mutation methods (table is append-only). |
| `src/main/ipc/handlers/audit.ts` | NEW. One channel `audit:list`. Thin pass-through. |
| `src/main/ipc/types.ts` | Add `audit:list` to IpcTypeMap. |
| `src/preload/bridge.ts` | Allowlist `audit:list`. |
| `tests/preload/bridge.test.ts` | Extended allowlist assertion. |
| `src/renderer/lib/api/audit.ts` | NEW. `auditApi.list(input)`. |
| `src/renderer/routes/audit.tsx` | NEW. The route. Owns filter state + TanStack Query for the list. |
| `src/renderer/components/audit/AuditEventCard.tsx` | NEW. Dispatcher card. Renders pretty-or-raw based on event_kind. |
| `src/renderer/components/audit/ActivityRebindCard.tsx` | NEW. Pretty renderer for `activity_rebind_ef`. |
| `src/renderer/components/audit/RawJsonCard.tsx` | NEW. Fallback renderer with formatted JSON + "Show raw" / "Hide raw" toggle. |
| `src/renderer/components/Sidebar.tsx` | Add "审计日志" nav item. |
| `src/shared/types.ts` | Add `AuditEvent` row type + `ActivityRebindEfPayload` typed payload. |
| `messages/en.json`, `messages/zh-CN.json` | ~15 new i18n keys (heading, filter labels, "Load older", empty state, ActivityRebindCard labels). |

### Why a typed payload shape

The DB column `payload TEXT NOT NULL CHECK(json_valid(payload))` is opaque. To render `activity_rebind_ef` prettily we need to know the field shape. Defining `ActivityRebindEfPayload` in `src/shared/types.ts` matching what `activity-data-service.ts` writes gives the renderer type safety. (The card component does `payload as ActivityRebindEfPayload` — typed-cast since the runtime check is `json_valid`, not schema-aware.)

---

## 3. API Contracts

```ts
// src/shared/types.ts
export type AuditEvent = {
  id: string;
  event_kind: string;
  payload: string; // JSON text — caller parses
  occurred_at: string; // ISO timestamp
};

export type ActivityRebindEfPayload = {
  activity_id: string;
  old_ef: EfCompositePk;
  new_ef: EfCompositePk;
  old_amount: number;
  old_unit: string;
  old_computed_co2e_kg: number;
  new_amount: number;
  new_unit: string;
  new_computed_co2e_kg: number;
};

// src/main/ipc/types.ts
'audit:list': (input: {
  event_kinds?: string[];     // empty / undefined = all kinds
  since?: string;             // ISO; default: 30 days ago
  until?: string;             // ISO; default: now
  limit?: number;             // default: 500
}) => AuditEvent[];

// src/main/services/audit-event-service.ts
class AuditEventService {
  constructor(private deps: { db: Database });
  list(input: {
    event_kinds?: string[];
    since?: string;
    until?: string;
    limit?: number;
  }): AuditEvent[];
}
```

The SQL behind `list`:

```sql
SELECT id, event_kind, payload, occurred_at
  FROM audit_event
 WHERE (? OR event_kind IN (?))                  -- event_kinds filter
   AND (? OR occurred_at >= ?)                   -- since
   AND (? OR occurred_at <= ?)                   -- until
 ORDER BY occurred_at DESC, id DESC
 LIMIT ?;
```

(Parameterized via better-sqlite3's named-parameter or positional `?` style — match the existing service patterns in this codebase.)

---

## 4. UI Behavior

### Filter row (top of `/audit`)

- **Event kind**: multi-select dropdown listing known event kinds. Initial known set: `['activity_rebind_ef']`. Future kinds appear automatically as soon as they show up in the data (the dropdown options are computed from a `SELECT DISTINCT event_kind FROM audit_event` query, joined with a hardcoded "always show" list of `['activity_rebind_ef']` even when count is zero).
- **Since / Until** date pickers. Default: today minus 30 days → today.
- **Reset** button clears filters.

### List

- Reverse chronological (newest first).
- 500-row limit per query.
- Each row is an `<AuditEventCard>`. The card header shows:
  - Event kind chip (color-coded — e.g. blue for `activity_rebind_ef`)
  - Localized timestamp (`occurred_at` formatted via `Intl.DateTimeFormat` with current locale)
- Card body delegates to a per-kind renderer:
  - `activity_rebind_ef` → `<ActivityRebindCard>`:
    - One-line summary: "重新镶嵌活动 `<activity_id_short>`: `<old_ef>` → `<new_ef>`"
    - Sub-line: "CO2e: 2,680 kg → 2,540 kg (-140 kg, -5.2%)"
    - Optional "Show raw payload" disclosure that toggles a `<pre>` of formatted JSON
  - Anything else → `<RawJsonCard>` with the formatted JSON visible by default

### Empty state

- When the query returns zero rows: a centered message "暂无审计事件 / No audit events yet" + small explanation: "Events are recorded as you confirm extractions, finalize answers, or rebind emission factors."

### Load older

- Button at the bottom of the list, visible only when the current query returned exactly `limit` rows (suggesting there might be more).
- Clicking it re-runs the query with `until = oldest row's occurred_at - 1ms` and appends results.

---

## 5. Error Handling

| Failure | Where | Behavior |
|---|---|---|
| Query DB error | service throws | Handler returns empty array + logs (or surfaces as toast — match existing patterns; likely `throw` propagates which TanStack Query catches into `error` state) |
| Malformed JSON in payload (would violate the CHECK constraint, so very rare) | `JSON.parse` in renderer throws | `<RawJsonCard>` catches and displays "Malformed payload" + the raw string |
| Filter with no matching rows | empty array | Empty-state message |

No mutation methods, so no UPDATE/DELETE error paths.

---

## 6. Testing Strategy

### Unit (vitest) — target ~6 new tests

**`tests/main/services/audit-event-service.test.ts`** — 3 tests:
1. `list()` with no filters returns rows in reverse chronological order
2. `list({ event_kinds: ['activity_rebind_ef'] })` filters correctly
3. `list({ since, until })` applies date range filter

**`tests/main/ipc/audit-handlers.test.ts`** — 1 test:
4. `audit:list` passes through to `service.list` and returns rows

### Renderer (vitest + happy-dom) — target ~3 new tests

**`tests/renderer/audit-page.test.tsx`** — 2 tests:
5. Renders a list with one `activity_rebind_ef` event using the pretty card
6. Renders empty-state message when no events match

**`tests/renderer/activity-rebind-card.test.tsx`** — 1 test:
7. Renders the one-line summary + sub-line with delta sign + percentage

### Out of scope (deliberately)

- E2E spec — deferred to consolidated phase-3 tag-time smoke.
- Snapshot of the audit list — brittle.

**Test count target:** 595 → ~602 (+7).

---

## 7. Dependencies

- No new top-level dependencies.
- Reuses: TanStack Query, paraglide i18n, existing date-picker primitive (or `<input type="date">` for v1 — picker primitive can be added later).

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| audit_event grows unbounded; query gets slow | 500-row limit + index on `(event_kind, occurred_at)` — index check; if missing in migration 006, add a follow-up migration. (At implementation time: run `grep idx_audit_kind_occurred src/main/db/migrations/`; index is documented to exist. Confirm.) |
| Future event_kinds don't have pretty renderers | Raw-JSON fallback shows full payload; user can still understand events even without per-kind UI. New renderers added incrementally as new producers ship. |
| Multi-locale ISO date display | `Intl.DateTimeFormat` with the current paraglide locale handles this; no custom formatter needed. |
| Date-range edge case (since > until) | Renderer guards; if since > until, swap or refuse with inline error. |

---

## 9. Acceptance

- `pnpm test` passes 602+ tests (595 baseline + ~7 new).
- `pnpm typecheck` clean.
- `biome check` no NEW errors.
- A user can:
  1. Navigate to `/audit`
  2. See the empty-state message (if they've never rebound an EF)
  3. Or — after rebinding via sub-project 2 — see the rebind event with old/new EF + delta
  4. Filter by event kind and date range
  5. Click "Load older" to extend the window

---

## 10. Future v1.5+

- Retrofitting existing services to emit audit events: extraction-service confirm/discard, answer-generation save/finalize, questionnaire-service finalize, document-service upload.
- Per-entity drill-in: "audit history for activity X" tab from the Activities list.
- Full-text search of payload via SQLite JSON1 functions.
- Export audit log (CSV).
- MCP tool: `list_audit_events` for AI-driven analysis ("what changed last week?").
- Undo from audit_event row (reverse a rebind).
