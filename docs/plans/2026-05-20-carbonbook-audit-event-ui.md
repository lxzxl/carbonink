# Audit Event UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/audit` route in the renderer that lists rows from the `audit_event` table with event-kind + date filters, reverse-chronological pagination, and per-kind pretty rendering (currently only `activity_rebind_ef`; raw-JSON fallback for any future kinds).

**Architecture:** New `AuditEventService.list()` (READ ONLY — table is append-only via existing trigger). One IPC channel `audit:list`. Renderer-side dispatcher `<AuditEventCard>` switches between `<ActivityRebindCard>` (pretty) and `<RawJsonCard>` (fallback). Filter state held in the route component; TanStack Query keyed on the filter object. No schema migration.

**Tech Stack:** TypeScript strict, React 18, TanStack Query, better-sqlite3, vitest, paraglide i18n.

**Spec:** `docs/specs/2026-05-20-audit-event-ui-design.md` (commit `a74de14`).

**Baseline:** 595 tests on `main`. Target after this sub-project: ~602 tests.

**Sub-project context:** This is sub-project 3 of 4 in Phase 3. After this lands, sub-project 4 = PDF rearrange export. Then Phase 3 is fully done.

**Recurring environmental hazard:** better-sqlite3 ABI flip. If 184+ tests fail with `NODE_MODULE_VERSION 145`:

```bash
rm node_modules/.pnpm/better-sqlite3@12.9.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node
pnpm rebuild better-sqlite3
```

Environmental, not a regression.

**Discipline reminder for implementers:** Before final commit on each task, run `git status` and confirm there are NO uncommitted file changes besides the `.claude/` untracked dir. `git add -A && git restore --staged .claude` before committing.

---

## Task 1: `AuditEventService.list` + types + tests

**Files:**
- Create: `src/main/services/audit-event-service.ts`
- Modify: `src/shared/types.ts` — add `AuditEvent` + `ActivityRebindEfPayload`
- Create: `tests/main/services/audit-event-service.test.ts`

Single read method with optional filters: `event_kinds[]`, `since`, `until`, `limit` (default 500). Returns reverse-chronological list.

- [ ] **Step 1: Add types to `src/shared/types.ts`**

Find an appropriate location (near other domain types). Add:

```ts
/**
 * Row shape mirroring the `audit_event` table (migration 006).
 * Append-only via DB triggers; readers parse `payload` as JSON.
 */
export type AuditEvent = {
  id: string;
  event_kind: string;
  /** JSON-text payload. Caller parses with `JSON.parse`. */
  payload: string;
  occurred_at: string;
};

/**
 * Typed shape of the `payload` for `event_kind === 'activity_rebind_ef'`.
 * Written by `ActivityDataService.rebindEf` (Phase 3 sub-project 2).
 */
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
```

- [ ] **Step 2: Write the failing service tests**

Create `tests/main/services/audit-event-service.test.ts`:

```ts
import { AuditEventService } from '@main/services/audit-event-service';
import { runMigrations } from '@main/db/migrate';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

function seedAuditRows(db: Database.Database) {
  // 3 rows: 2 activity_rebind_ef, 1 fake other_kind, varying timestamps.
  db.prepare(
    `INSERT INTO audit_event (id, event_kind, payload, occurred_at) VALUES
     ('aud-1', 'activity_rebind_ef',
       '{"activity_id":"act-1","old_ef":{"factor_code":"a"},"new_ef":{"factor_code":"b"}}',
       '2026-05-18T10:00:00Z'),
     ('aud-2', 'other_kind',
       '{"foo":"bar"}',
       '2026-05-19T11:00:00Z'),
     ('aud-3', 'activity_rebind_ef',
       '{"activity_id":"act-2","old_ef":{"factor_code":"c"},"new_ef":{"factor_code":"d"}}',
       '2026-05-20T12:00:00Z')`,
  ).run();
}

describe('AuditEventService.list', () => {
  it('returns rows in reverse chronological order with no filters', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    seedAuditRows(db);
    const svc = new AuditEventService({ db });
    const rows = svc.list({});
    expect(rows.map((r) => r.id)).toEqual(['aud-3', 'aud-2', 'aud-1']);
  });

  it('filters by event_kinds', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    seedAuditRows(db);
    const svc = new AuditEventService({ db });
    const rows = svc.list({ event_kinds: ['activity_rebind_ef'] });
    expect(rows.map((r) => r.id)).toEqual(['aud-3', 'aud-1']);
  });

  it('filters by since + until date range', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    seedAuditRows(db);
    const svc = new AuditEventService({ db });
    const rows = svc.list({
      since: '2026-05-19T00:00:00Z',
      until: '2026-05-19T23:59:59Z',
    });
    expect(rows.map((r) => r.id)).toEqual(['aud-2']);
  });

  it('caps results at limit', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    seedAuditRows(db);
    const svc = new AuditEventService({ db });
    const rows = svc.list({ limit: 2 });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id)).toEqual(['aud-3', 'aud-2']);
  });
});
```

- [ ] **Step 3: Run, confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/services/audit-event-service.test.ts --pool=threads 2>&1 | tail -15
```

Expected: FAIL — `Cannot find module '@main/services/audit-event-service'`.

- [ ] **Step 4: Implement the service**

Create `src/main/services/audit-event-service.ts`:

```ts
import type Database from 'better-sqlite3';
import type { AuditEvent } from '@shared/types.js';

export interface AuditEventDeps {
  db: Database.Database;
}

export interface AuditEventListInput {
  /** If absent or empty array, no event_kind filter applied. */
  event_kinds?: string[];
  /** ISO timestamp; default = no lower bound. */
  since?: string;
  /** ISO timestamp; default = no upper bound. */
  until?: string;
  /** Default 500. Hard cap at 5000. */
  limit?: number;
}

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;

export class AuditEventService {
  constructor(private deps: AuditEventDeps) {}

  list(input: AuditEventListInput): AuditEvent[] {
    const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const kinds = input.event_kinds ?? [];

    // Build dynamic WHERE clauses. Parameterized for safety.
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (kinds.length > 0) {
      const placeholders = kinds.map(() => '?').join(', ');
      clauses.push(`event_kind IN (${placeholders})`);
      params.push(...kinds);
    }
    if (input.since) {
      clauses.push('occurred_at >= ?');
      params.push(input.since);
    }
    if (input.until) {
      clauses.push('occurred_at <= ?');
      params.push(input.until);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const sql = `
      SELECT id, event_kind, payload, occurred_at
        FROM audit_event
        ${where}
       ORDER BY occurred_at DESC, id DESC
       LIMIT ?
    `;
    params.push(limit);

    return this.deps.db.prepare(sql).all(...params) as AuditEvent[];
  }
}
```

- [ ] **Step 5: Verify**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -10
pnpm vitest run tests/main/services/audit-event-service.test.ts --pool=threads 2>&1 | tail -10
pnpm vitest run --pool=threads 2>&1 | tail -8
```

Expected: typecheck clean; 4/4 new tests pass; ~599 total (595 + 4).

- [ ] **Step 6: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git status
git add -A && git restore --staged .claude || true
git commit -m "feat(audit): AuditEventService.list + AuditEvent type"
git log --oneline -3
git branch --show-current
```

Branch must be `main`.

---

## Task 2: IPC channel + handler + bridge allowlist

**Files:**
- Modify: `src/main/ipc/types.ts`
- Create: `src/main/ipc/handlers/audit.ts`
- Modify: `src/main/ipc/context.ts` — add `auditEventService`
- Modify: `src/main/ipc/setup.ts` (or wherever handlers are wired) — register `auditHandlers(ctx)`
- Modify: `src/preload/bridge.ts` — allowlist `audit:list`
- Modify: `tests/preload/bridge.test.ts` — extend allowlist assertion
- Create: `tests/main/ipc/audit-handlers.test.ts`
- Create or modify: `src/renderer/lib/api/audit.ts`

Single channel `audit:list`. Pass-through to service with zod input validation.

- [ ] **Step 1: Extend IpcTypeMap**

Edit `src/main/ipc/types.ts`. Add a new section near the bottom (or after the report domain section from Phase 3 sub-project 1):

```ts
  // audit domain (Phase 3 sub-project 3 — audit_event log viewer)
  'audit:list': (input: {
    event_kinds?: string[];
    since?: string;
    until?: string;
    limit?: number;
  }) => import('@shared/types.js').AuditEvent[];
```

If the file already imports `AuditEvent` at top-level, use it directly instead of the inline `import('...')`.

- [ ] **Step 2: Write the failing handler test**

Create `tests/main/ipc/audit-handlers.test.ts`:

```ts
import { auditHandlers } from '@main/ipc/handlers/audit';
import type { IpcContext } from '@main/ipc/context';
import { describe, expect, it, vi } from 'vitest';

function makeCtx() {
  return {
    auditEventService: {
      list: vi.fn().mockReturnValue([
        { id: 'aud-1', event_kind: 'activity_rebind_ef', payload: '{}', occurred_at: '2026-05-20T00:00:00Z' },
      ]),
    },
  } as unknown as IpcContext;
}

describe('audit handlers', () => {
  it('audit:list passes filters through to service.list', () => {
    const ctx = makeCtx();
    const handlers = auditHandlers(ctx);
    const result = handlers['audit:list']!({
      event_kinds: ['activity_rebind_ef'],
      since: '2026-05-01T00:00:00Z',
      limit: 100,
    });
    expect(result).toHaveLength(1);
    expect(ctx.auditEventService.list).toHaveBeenCalledWith({
      event_kinds: ['activity_rebind_ef'],
      since: '2026-05-01T00:00:00Z',
      limit: 100,
    });
  });

  it('audit:list passes empty input through cleanly', () => {
    const ctx = makeCtx();
    const handlers = auditHandlers(ctx);
    const result = handlers['audit:list']!({});
    expect(result).toHaveLength(1);
    expect(ctx.auditEventService.list).toHaveBeenCalledWith({});
  });
});
```

- [ ] **Step 3: Run, confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/ipc/audit-handlers.test.ts --pool=threads 2>&1 | tail -15
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement the handler**

Create `src/main/ipc/handlers/audit.ts`:

```ts
import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

const listInput = z.object({
  event_kinds: z.array(z.string().min(1)).optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  limit: z.number().int().positive().optional(),
});

/**
 * Audit-event read-only handler. The table is append-only via DB trigger;
 * producers write directly from their own services (e.g.
 * ActivityDataService.rebindEf writes `event_kind = 'activity_rebind_ef'`).
 * This handler exposes a single query path with optional filters.
 */
export function auditHandlers(ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  return {
    'audit:list': (input) => ctx.auditEventService.list(listInput.parse(input)),
  };
}
```

- [ ] **Step 5: Wire into context + setup**

Edit `src/main/ipc/context.ts`. In the `IpcContext` type, add:

```ts
  auditEventService: AuditEventService;
```

Import `AuditEventService` at the top. Add a construction line at the bottom of the `createIpcContext` function (or whatever the construction site is called):

```ts
  const auditEventService = new AuditEventService({ db });
  // ... return statement gains: auditEventService,
```

Edit `src/main/ipc/setup.ts` (or `src/main/ipc/index.ts` — whichever wires handler factories). Register `auditHandlers(ctx)` in the existing `HANDLER_FACTORIES` array.

- [ ] **Step 6: Allowlist**

Edit `src/preload/bridge.ts`. Add a new section after the report domain:

```ts
  // audit domain (Phase 3 sub-project 3 — audit_event log viewer)
  'audit:list',
```

Edit `tests/preload/bridge.test.ts`. Extend the `allowedChannels` assertion to include `'audit:list'` as the last entry (or in a new "audit domain" group).

- [ ] **Step 7: Renderer API client**

Create `src/renderer/lib/api/audit.ts`:

```ts
import { invoke } from '../ipc';

export const auditApi = {
  list: (input: {
    event_kinds?: string[];
    since?: string;
    until?: string;
    limit?: number;
  }) => invoke('audit:list', input),
};
```

- [ ] **Step 8: Verify**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -10
pnpm vitest run tests/main/ipc/audit-handlers.test.ts --pool=threads 2>&1 | tail -10
pnpm vitest run tests/preload/bridge.test.ts --pool=threads 2>&1 | tail -10
pnpm vitest run --pool=threads 2>&1 | tail -8
```

Expected: typecheck clean; 2/2 new handler tests pass; bridge test still passes; ~601 total.

- [ ] **Step 9: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git status
git add -A && git restore --staged .claude || true
git commit -m "feat(ipc): audit:list channel + handler"
git log --oneline -3
git branch --show-current
```

---

## Task 3: AuditEventCard dispatcher + per-kind renderers

**Files:**
- Create: `src/renderer/components/audit/AuditEventCard.tsx`
- Create: `src/renderer/components/audit/ActivityRebindCard.tsx`
- Create: `src/renderer/components/audit/RawJsonCard.tsx`
- Create: `tests/renderer/activity-rebind-card.test.tsx`
- Modify: `messages/en.json`, `messages/zh-CN.json` (add 7 i18n keys for this task; the route adds more in Task 4)

`<AuditEventCard>` examines `event.event_kind` and dispatches to a pretty renderer if one exists; otherwise `<RawJsonCard>`.

- [ ] **Step 1: Add i18n keys for the cards**

Add to `messages/en.json` and `messages/zh-CN.json`:

```
audit_event_kind_activity_rebind_ef   "Rebind emission factor"     /  "重新镶嵌排放因子"
audit_show_raw                        "Show raw payload"           /  "显示原始数据"
audit_hide_raw                        "Hide raw payload"           /  "隐藏原始数据"
audit_rebind_summary                  "Rebound activity {activity_id_short}: {old_ef} → {new_ef}"  /  "重新镶嵌活动 {activity_id_short}: {old_ef} → {new_ef}"
audit_rebind_delta                    "CO2e: {old_co2e} kg → {new_co2e} kg ({delta_signed} kg, {pct_signed}%)"  /  "CO2e: {old_co2e} kg → {new_co2e} kg ({delta_signed} kg, {pct_signed}%)"
audit_unknown_event_kind              "Unknown event kind: {kind}" /  "未知事件类型: {kind}"
audit_malformed_payload               "Malformed payload"          /  "数据格式异常"
```

Recompile paraglide:

```bash
cd /Users/lxz/ws/personal/carbonbook
npx paraglide-js compile --project ./project.inlang --outdir ./src/renderer/paraglide
```

- [ ] **Step 2: Write the failing test**

Create `tests/renderer/activity-rebind-card.test.tsx`:

```tsx
import { ActivityRebindCard } from '@renderer/components/audit/ActivityRebindCard';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '@shared/types';

const event: AuditEvent = {
  id: 'aud-1',
  event_kind: 'activity_rebind_ef',
  payload: JSON.stringify({
    activity_id: '01HXX9YYABCDEFGHIJKLMNOPQR',
    old_ef: { factor_code: 'diesel_L', year: 2024, source: 'MEE', geography: 'CN', dataset_version: '2024.1' },
    new_ef: { factor_code: 'diesel_kg', year: 2025, source: 'IPCC', geography: 'CN', dataset_version: '2025.1' },
    old_amount: 1000,
    old_unit: 'L',
    old_computed_co2e_kg: 2680,
    new_amount: 800,
    new_unit: 'kg',
    new_computed_co2e_kg: 2540,
  }),
  occurred_at: '2026-05-20T12:00:00Z',
};

describe('<ActivityRebindCard>', () => {
  it('renders summary with shortened activity id + old/new EF codes', () => {
    render(<ActivityRebindCard event={event} />);
    // Activity id shortened to first 8 chars
    expect(screen.getByText(/01HXX9YY/)).toBeTruthy();
    expect(screen.getByText(/diesel_L/)).toBeTruthy();
    expect(screen.getByText(/diesel_kg/)).toBeTruthy();
  });

  it('renders delta with signed values and percentage', () => {
    render(<ActivityRebindCard event={event} />);
    // Delta = 2540 - 2680 = -140; pct = -140/2680*100 ≈ -5.2%
    expect(screen.getByText(/2,?680/)).toBeTruthy();
    expect(screen.getByText(/2,?540/)).toBeTruthy();
    expect(screen.getByText(/-140|−140/)).toBeTruthy();
    expect(screen.getByText(/-5\.2|−5\.2/)).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run, confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/renderer/activity-rebind-card.test.tsx --pool=threads 2>&1 | tail -15
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement `<RawJsonCard>`**

Create `src/renderer/components/audit/RawJsonCard.tsx`:

```tsx
import { useState } from 'react';
import type { AuditEvent } from '@shared/types';
import * as m from '@renderer/paraglide/messages';

export function RawJsonCard({ event }: { event: AuditEvent }) {
  const [showRaw, setShowRaw] = useState(true);
  let pretty: string;
  try {
    pretty = JSON.stringify(JSON.parse(event.payload), null, 2);
  } catch {
    pretty = event.payload;
  }
  return (
    <div className="audit-raw-card">
      <button type="button" onClick={() => setShowRaw((v) => !v)} className="text-xs underline">
        {showRaw ? m.audit_hide_raw() : m.audit_show_raw()}
      </button>
      {showRaw && (
        <pre className="text-xs bg-muted p-2 rounded mt-1 overflow-auto">{pretty}</pre>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Implement `<ActivityRebindCard>`**

Create `src/renderer/components/audit/ActivityRebindCard.tsx`:

```tsx
import { useState } from 'react';
import type { ActivityRebindEfPayload, AuditEvent } from '@shared/types';
import * as m from '@renderer/paraglide/messages';

function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
}

function signed(n: number, digits = 0): string {
  const fixed = n.toFixed(digits);
  return n >= 0 ? `+${fixed}` : fixed;
}

export function ActivityRebindCard({ event }: { event: AuditEvent }) {
  const [showRaw, setShowRaw] = useState(false);
  let payload: ActivityRebindEfPayload | null = null;
  let parseError = false;
  try {
    payload = JSON.parse(event.payload) as ActivityRebindEfPayload;
  } catch {
    parseError = true;
  }
  if (parseError || !payload) {
    return <div className="text-sm text-destructive">{m.audit_malformed_payload()}</div>;
  }

  const delta = payload.new_computed_co2e_kg - payload.old_computed_co2e_kg;
  const pct =
    payload.old_computed_co2e_kg === 0
      ? 0
      : (delta / payload.old_computed_co2e_kg) * 100;
  const activityIdShort = payload.activity_id.slice(0, 8);

  return (
    <div className="audit-rebind-card">
      <div className="text-sm">
        {m.audit_rebind_summary({
          activity_id_short: activityIdShort,
          old_ef: payload.old_ef.factor_code,
          new_ef: payload.new_ef.factor_code,
        })}
      </div>
      <div className="text-sm text-muted-foreground mt-1">
        {m.audit_rebind_delta({
          old_co2e: formatNumber(payload.old_computed_co2e_kg),
          new_co2e: formatNumber(payload.new_computed_co2e_kg),
          delta_signed: signed(delta),
          pct_signed: signed(pct, 1),
        })}
      </div>
      <button
        type="button"
        onClick={() => setShowRaw((v) => !v)}
        className="text-xs underline mt-2"
      >
        {showRaw ? m.audit_hide_raw() : m.audit_show_raw()}
      </button>
      {showRaw && (
        <pre className="text-xs bg-muted p-2 rounded mt-1 overflow-auto">
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Implement `<AuditEventCard>` dispatcher**

Create `src/renderer/components/audit/AuditEventCard.tsx`:

```tsx
import type { AuditEvent } from '@shared/types';
import { ActivityRebindCard } from './ActivityRebindCard';
import { RawJsonCard } from './RawJsonCard';
import * as m from '@renderer/paraglide/messages';

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function kindLabel(kind: string): string {
  switch (kind) {
    case 'activity_rebind_ef':
      return m.audit_event_kind_activity_rebind_ef();
    default:
      return m.audit_unknown_event_kind({ kind });
  }
}

const KIND_COLORS: Record<string, string> = {
  activity_rebind_ef: 'bg-blue-100 text-blue-800',
};

export function AuditEventCard({ event }: { event: AuditEvent }) {
  const chipClass = KIND_COLORS[event.event_kind] ?? 'bg-gray-100 text-gray-800';
  return (
    <article className="audit-card border rounded p-3 mb-2">
      <header className="flex items-center justify-between mb-2">
        <span className={`text-xs px-2 py-0.5 rounded ${chipClass}`}>
          {kindLabel(event.event_kind)}
        </span>
        <time className="text-xs text-muted-foreground">{formatDate(event.occurred_at)}</time>
      </header>
      {event.event_kind === 'activity_rebind_ef' ? (
        <ActivityRebindCard event={event} />
      ) : (
        <RawJsonCard event={event} />
      )}
    </article>
  );
}
```

- [ ] **Step 7: Verify**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -10
pnpm vitest run tests/renderer/activity-rebind-card.test.tsx --pool=threads 2>&1 | tail -10
pnpm vitest run --pool=threads 2>&1 | tail -8
```

Expected: typecheck clean; 2/2 new card tests pass; ~603 total.

- [ ] **Step 8: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git status
git add -A && git restore --staged .claude || true
git commit -m "feat(ui): audit event cards — dispatcher + ActivityRebind + RawJson"
git log --oneline -3
git branch --show-current
```

---

## Task 4: `/audit` route + Sidebar nav + page tests

**Files:**
- Create: `src/renderer/routes/audit.tsx`
- Modify: `src/renderer/components/Sidebar.tsx` — add nav item
- Modify: `messages/en.json`, `messages/zh-CN.json` (8 more i18n keys)
- Create: `tests/renderer/audit-page.test.tsx`

- [ ] **Step 1: Add remaining i18n keys**

Add to `messages/en.json` + `messages/zh-CN.json`:

```
audit_nav                          "Audit log"                                 /  "审计日志"
audit_heading                      "Audit log"                                 /  "审计日志"
audit_subheading                   "Track changes to your inventory."          /  "查看清单的变更历史。"
audit_filter_event_kind_label      "Event kind"                                /  "事件类型"
audit_filter_since_label           "Since"                                     /  "起始日期"
audit_filter_until_label           "Until"                                     /  "截止日期"
audit_filter_reset_button          "Reset filters"                             /  "重置筛选"
audit_load_older_button            "Load older"                                /  "加载更早"
audit_empty_state_heading          "No audit events yet"                       /  "暂无审计事件"
audit_empty_state_body             "Events are recorded as you confirm extractions, finalize answers, or rebind emission factors."  /  "在你确认抽取、定稿答案或重新镶嵌排放因子时会自动记录事件。"
```

Recompile paraglide:

```bash
cd /Users/lxz/ws/personal/carbonbook
npx paraglide-js compile --project ./project.inlang --outdir ./src/renderer/paraglide
```

- [ ] **Step 2: Write the failing renderer test**

Create `tests/renderer/audit-page.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const sampleRow = {
  id: 'aud-1',
  event_kind: 'activity_rebind_ef',
  payload: JSON.stringify({
    activity_id: 'act-12345678',
    old_ef: { factor_code: 'diesel_L', year: 2024, source: 'MEE', geography: 'CN', dataset_version: '2024.1' },
    new_ef: { factor_code: 'diesel_kg', year: 2025, source: 'IPCC', geography: 'CN', dataset_version: '2025.1' },
    old_amount: 1000,
    old_unit: 'L',
    old_computed_co2e_kg: 2680,
    new_amount: 800,
    new_unit: 'kg',
    new_computed_co2e_kg: 2540,
  }),
  occurred_at: '2026-05-20T12:00:00Z',
};

vi.mock('@renderer/lib/api/audit', () => ({
  auditApi: { list: vi.fn() },
}));

describe('Audit page', () => {
  it('renders an activity_rebind_ef event with the pretty card', async () => {
    const { auditApi } = await import('@renderer/lib/api/audit');
    vi.mocked(auditApi.list).mockResolvedValue([sampleRow] as never);

    const { AuditPage } = await import('@renderer/routes/audit');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AuditPage />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/diesel_L/)).toBeTruthy();
      expect(screen.getByText(/diesel_kg/)).toBeTruthy();
    });
  });

  it('shows empty-state message when no events match', async () => {
    const { auditApi } = await import('@renderer/lib/api/audit');
    vi.mocked(auditApi.list).mockResolvedValue([] as never);

    const { AuditPage } = await import('@renderer/routes/audit');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AuditPage />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      // Match the English OR Chinese empty-state heading
      expect(
        screen.queryByText(/No audit events yet|暂无审计事件/),
      ).toBeTruthy();
    });
  });
});
```

- [ ] **Step 3: Run, confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/renderer/audit-page.test.tsx --pool=threads 2>&1 | tail -15
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement the `/audit` route**

Create `src/renderer/routes/audit.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { auditApi } from '@renderer/lib/api/audit';
import { AuditEventCard } from '@renderer/components/audit/AuditEventCard';
import * as m from '@renderer/paraglide/messages';

export const Route = createFileRoute('/audit')({ component: AuditPage });

function defaultSinceIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString();
}

const KNOWN_EVENT_KINDS = ['activity_rebind_ef'];

export function AuditPage() {
  const [selectedKinds, setSelectedKinds] = useState<string[]>([]);
  const [since, setSince] = useState<string>(defaultSinceIso().slice(0, 10)); // YYYY-MM-DD
  const [until, setUntil] = useState<string>(new Date().toISOString().slice(0, 10));
  const [limit, setLimit] = useState<number>(500);

  const queryInput = useMemo(
    () => ({
      event_kinds: selectedKinds.length > 0 ? selectedKinds : undefined,
      since: since ? `${since}T00:00:00Z` : undefined,
      until: until ? `${until}T23:59:59Z` : undefined,
      limit,
    }),
    [selectedKinds, since, until, limit],
  );

  const eventsQuery = useQuery({
    queryKey: ['audit:list', queryInput],
    queryFn: () => auditApi.list(queryInput),
  });

  const events = eventsQuery.data ?? [];
  const canLoadOlder = events.length >= limit;

  const toggleKind = (kind: string) => {
    setSelectedKinds((prev) =>
      prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind],
    );
  };

  const reset = () => {
    setSelectedKinds([]);
    setSince(defaultSinceIso().slice(0, 10));
    setUntil(new Date().toISOString().slice(0, 10));
    setLimit(500);
  };

  return (
    <div className="container mx-auto py-8 px-4 max-w-3xl">
      <h1 className="text-2xl font-semibold mb-1">{m.audit_heading()}</h1>
      <p className="text-sm text-muted-foreground mb-6">{m.audit_subheading()}</p>

      <section className="border rounded p-3 mb-4 space-y-2">
        <div>
          <label className="text-sm font-medium">{m.audit_filter_event_kind_label()}: </label>
          {KNOWN_EVENT_KINDS.map((kind) => (
            <label key={kind} className="inline-flex items-center gap-1 ml-3 text-sm">
              <input
                type="checkbox"
                checked={selectedKinds.includes(kind)}
                onChange={() => toggleKind(kind)}
              />
              {kind}
            </label>
          ))}
        </div>
        <div className="flex gap-3 items-center text-sm">
          <label className="flex items-center gap-1">
            {m.audit_filter_since_label()}:
            <input
              type="date"
              value={since}
              onChange={(e) => setSince(e.target.value)}
              className="border rounded px-1"
            />
          </label>
          <label className="flex items-center gap-1">
            {m.audit_filter_until_label()}:
            <input
              type="date"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
              className="border rounded px-1"
            />
          </label>
          <button type="button" onClick={reset} className="text-sm underline ml-auto">
            {m.audit_filter_reset_button()}
          </button>
        </div>
      </section>

      {eventsQuery.isPending && <p>Loading…</p>}

      {!eventsQuery.isPending && events.length === 0 && (
        <div className="text-center py-12">
          <h2 className="text-base font-medium">{m.audit_empty_state_heading()}</h2>
          <p className="text-sm text-muted-foreground mt-2">{m.audit_empty_state_body()}</p>
        </div>
      )}

      {events.map((ev) => (
        <AuditEventCard key={ev.id} event={ev} />
      ))}

      {canLoadOlder && (
        <button
          type="button"
          onClick={() => setLimit((l) => l + 500)}
          className="mt-4 rounded border px-3 py-2 text-sm"
        >
          {m.audit_load_older_button()}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Sidebar integration**

Edit `src/renderer/components/Sidebar.tsx`. Add a new nav item linking to `/audit` (near other top-level routes like Reports, Documents). Use a sensible icon (e.g. `History` or `FileClock` from the icon library if available; otherwise reuse an existing icon for now).

```tsx
<Link to="/audit" className={navClass}>
  <Icon name="history" />
  <span>{m.audit_nav()}</span>
</Link>
```

Match the exact pattern used by the existing Reports / Documents nav items.

- [ ] **Step 6: routeTree.gen.ts**

TanStack Router's vite plugin auto-regenerates `src/renderer/routeTree.gen.ts` when the new route file is added and the dev server (or typecheck) runs. If `pnpm typecheck` fails because the gen file is stale, run `pnpm dev` briefly to let the plugin regenerate, then kill it. Commit the updated gen file.

- [ ] **Step 7: Verify**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -10
pnpm vitest run tests/renderer/audit-page.test.tsx --pool=threads 2>&1 | tail -15
pnpm vitest run --pool=threads 2>&1 | tail -8
```

Expected: typecheck clean; 2/2 audit page tests pass; ~605 total (603 + 2). If you see ~602, the AuditPage tests might be counting differently — that's fine, just confirm green.

- [ ] **Step 8: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git status
git add -A && git restore --staged .claude || true
git commit -m "feat(ui): /audit route + Sidebar nav + filters + empty state"
git log --oneline -3
git branch --show-current
```

---

## Task 5: Sweep + verification

- [ ] **Step 1: Full suite + typecheck**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -8
pnpm typecheck
```

Expected: ~602-605 tests passing, typecheck clean.

If 184+ failures with `NODE_MODULE_VERSION 145`:

```bash
rm node_modules/.pnpm/better-sqlite3@12.9.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node
pnpm rebuild better-sqlite3
pnpm vitest run --pool=threads 2>&1 | tail -8
```

- [ ] **Step 2: format + biome (autofix touched files)**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm format 2>&1 | tail -3
pnpm exec biome check --write 2>&1 | tail -10
```

The 4 pre-existing biome errors (unrelated files) will remain. Don't touch them. Only fix new issues your sub-project introduced.

- [ ] **Step 3: Re-run tests to verify autofix didn't break anything**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -6
```

- [ ] **Step 4: Final commit + history**

```bash
cd /Users/lxz/ws/personal/carbonbook
git status
git add -A && git restore --staged .claude || true
git commit -m "chore: biome sweep for audit event UI" || true
git log --oneline -10
git branch --show-current
```

---

## Closeout

Phase 3 sub-project 3 lands on `main`:

- `AuditEventService.list` — single read method with event-kind + date-range filters + limit cap.
- `audit:list` IPC channel.
- `<AuditEventCard>` dispatcher + `<ActivityRebindCard>` pretty renderer + `<RawJsonCard>` fallback.
- `/audit` route with filter controls, empty state, "Load older" pagination.
- Sidebar nav item "审计日志".
- ~15 new i18n keys.
- ~7 new tests (595 → ~602).

**Manual smoke deferred** to consolidated phase-3 tag-time verification:

- Rebind an EF in the app, navigate to `/audit`, verify the new event appears at the top with pretty rendering.
- Filter by event_kind, narrow date range, verify list updates.
- "Load older" extends results when more than 500 rows exist.

**Next sub-project (Phase 3 final):**

- Sub-project 4: PDF rearrange export (questionnaire-side PDF companion to the answer Excel export). Last Phase 3 sub-project.
