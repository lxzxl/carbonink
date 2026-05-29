# Phase 0 Task 7: Migration runner

> Extracted from `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md` lines 935-1088.
> Pre-split for context-budget reasons; canonical source remains the full plan.

---

### Task 7: Migration runner

**Files:**
- Create: `src/main/db/migrate.ts`
- Create: `tests/main/db/migrate.test.ts`
- Create: `src/main/db/migrations/000_meta.sql`

- [ ] **Step 1: 写 migrations/000_meta.sql (schema_migrations 表自身的 bootstrap)**

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
```

- [ ] **Step 2: 写失败测试 tests/main/db/migrate.test.ts**

```ts
import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { openAppDb, closeAppDb } from '@main/db/connection';
import { runMigrations } from '@main/db/migrate';

describe('runMigrations', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `carbonbook-mig-${Date.now()}-${Math.random()}.sqlite`);
  });

  afterEach(() => {
    closeAppDb();
    try { rmSync(dbPath); } catch { /* ignore */ }
  });

  it('creates schema_migrations and records applied versions', () => {
    const db = openAppDb(dbPath);
    runMigrations(db);
    const rows = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({ version: 0, name: '000_meta' });
  });

  it('is idempotent — running twice does not re-apply', () => {
    const db = openAppDb(dbPath);
    runMigrations(db);
    const beforeCount = db.prepare('SELECT COUNT(*) as c FROM schema_migrations').get() as { c: number };
    runMigrations(db);
    const afterCount = db.prepare('SELECT COUNT(*) as c FROM schema_migrations').get() as { c: number };
    expect(afterCount.c).toBe(beforeCount.c);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm test tests/main/db/migrate.test.ts`
Expected: FAIL ("Cannot find module '@main/db/migrate'")

- [ ] **Step 4: 写 src/main/db/migrate.ts**

> ⚠️ 不能用 `readFileSync(join(__dirname, 'migrations'))` 走运行时文件读取——electron-vite build 后 SQL 文件不会跟着 `.js` bundle 进 `out/main/db/migrations/`，dev 也可能不一致。改用 Vite 的 `import.meta.glob` + `?raw` 在 build time 把 SQL 内容编进主进程 bundle。这条同时在 Vitest（vite-driven）和 electron-vite 下都可用。

```ts
import type { Database } from 'better-sqlite3';

interface Migration {
  version: number;
  name: string;
  sql: string;
}

// Vite glob import: 在 build time 把 SQL 内容内联进 bundle。
// `eager: true` 让 Vite 同步加载；`?raw` 让 SQL 文件作为字符串引入。
const sqlModules = import.meta.glob<string>('./migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function loadMigrations(): Migration[] {
  const entries = Object.entries(sqlModules)
    // 按文件名排序（路径形如 './migrations/001_core.sql'）
    .sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([path, sql]) => {
    const filename = path.split('/').pop()!;
    const match = filename.match(/^(\d{3})_(.+)\.sql$/);
    if (!match) throw new Error(`Migration filename invalid: ${path}`);
    return {
      version: Number.parseInt(match[1]!, 10),
      name: filename.replace(/\.sql$/, ''),
      sql,
    };
  });
}

export function runMigrations(db: Database): void {
  const migrations = loadMigrations();
  if (migrations.length === 0) throw new Error('No migrations found');

  // Bootstrap: run 000_meta first if schema_migrations does not exist
  const tableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
    .get();
  if (!tableExists) {
    const bootstrap = migrations.find((m) => m.version === 0);
    if (!bootstrap) throw new Error('Missing 000_meta migration');
    db.exec(bootstrap.sql);
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
      0,
      '000_meta',
      new Date().toISOString(),
    );
  }

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map(
      (r) => r.version,
    ),
  );

  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    const tx = db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        m.version,
        m.name,
        new Date().toISOString(),
      );
    });
    tx();
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm test tests/main/db/migrate.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add src/main/db/migrate.ts src/main/db/migrations/000_meta.sql tests/main/db/migrate.test.ts
git commit -m "Phase 0/Task 7: SQL migration runner (sequential, idempotent)"
```

---

