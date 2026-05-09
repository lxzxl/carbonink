# Phase 0 Task 13: Migration 006 — audit_event + triggers

> Extracted from `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md` lines 1595-1697.
> Pre-split for context-budget reasons; canonical source remains the full plan.

---

### Task 13: Migration 006 — audit_event + triggers

**Files:**
- Create: `src/main/db/migrations/006_audit.sql`
- Create: `tests/main/db/audit-trigger.test.ts`

per spec §3：audit_event append-only，UPDATE/DELETE 用 trigger 抛异常。

- [ ] **Step 1: 写 006_audit.sql**

```sql
CREATE TABLE audit_event (
  id            TEXT PRIMARY KEY,
  event_kind    TEXT NOT NULL,
  payload       TEXT NOT NULL CHECK(json_valid(payload)),
  occurred_at   TEXT NOT NULL
);
CREATE INDEX idx_audit_occurred ON audit_event(occurred_at);
CREATE INDEX idx_audit_kind_occurred ON audit_event(event_kind, occurred_at);

CREATE TRIGGER audit_event_no_update
BEFORE UPDATE ON audit_event
BEGIN
  SELECT RAISE(ABORT, 'audit_event is append-only');
END;

CREATE TRIGGER audit_event_no_delete
BEFORE DELETE ON audit_event
BEGIN
  SELECT RAISE(ABORT, 'audit_event is append-only');
END;
```

- [ ] **Step 2: 写失败测试 tests/main/db/audit-trigger.test.ts**

```ts
import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { openAppDb, closeAppDb } from '@main/db/connection';
import { runMigrations } from '@main/db/migrate';

describe('audit_event append-only triggers', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `cb-audit-${Date.now()}-${Math.random()}.sqlite`);
  });

  afterEach(() => {
    closeAppDb();
    try { rmSync(dbPath); } catch { /* ignore */ }
  });

  it('allows INSERT', () => {
    const db = openAppDb(dbPath);
    runMigrations(db);
    expect(() =>
      db.prepare('INSERT INTO audit_event (id, event_kind, payload, occurred_at) VALUES (?, ?, ?, ?)').run(
        'evt_1', 'license_activated', '{}', '2026-01-01T00:00:00Z',
      ),
    ).not.toThrow();
  });

  it('rejects UPDATE', () => {
    const db = openAppDb(dbPath);
    runMigrations(db);
    db.prepare('INSERT INTO audit_event (id, event_kind, payload, occurred_at) VALUES (?, ?, ?, ?)').run(
      'evt_1', 'license_activated', '{}', '2026-01-01T00:00:00Z',
    );
    expect(() =>
      db.prepare('UPDATE audit_event SET event_kind = ? WHERE id = ?').run('changed', 'evt_1'),
    ).toThrow(/append-only/);
  });

  it('rejects DELETE', () => {
    const db = openAppDb(dbPath);
    runMigrations(db);
    db.prepare('INSERT INTO audit_event (id, event_kind, payload, occurred_at) VALUES (?, ?, ?, ?)').run(
      'evt_1', 'license_activated', '{}', '2026-01-01T00:00:00Z',
    );
    expect(() =>
      db.prepare('DELETE FROM audit_event WHERE id = ?').run('evt_1'),
    ).toThrow(/append-only/);
  });
});
```

- [ ] **Step 3: 跑测试确认通过**

Run: `pnpm test tests/main/db/audit-trigger.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 4: Commit**

```bash
git add src/main/db/migrations/006_audit.sql tests/main/db/audit-trigger.test.ts
git commit -m "Phase 0/Task 13: migration 006 (audit_event + append-only triggers)"
```

---

