import type { Database } from 'better-sqlite3';

interface Migration {
  version: number;
  name: string;
  sql: string;
}

// Vite glob import: 在 build time 把 SQL 内容内联进 bundle。
// `eager: true` 让 Vite 同步加载；`?raw` 让 SQL 文件作为字符串引入。
// 这条同时在 Vitest（vite-driven）和 electron-vite 下都可用。
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
    const filename = path.split('/').pop();
    if (!filename) throw new Error(`Migration path invalid: ${path}`);
    const match = filename.match(/^(\d{3})_(.+)\.sql$/);
    if (!match) throw new Error(`Migration filename invalid: ${path}`);
    return {
      version: Number.parseInt(match[1] as string, 10),
      name: filename.replace(/\.sql$/, ''),
      sql,
    };
  });
}

export function runMigrations(db: Database): void {
  const migrations = loadMigrations();
  if (migrations.length === 0) throw new Error('No migrations found');

  // Bootstrap: run 000_meta first if schema_migrations does not exist.
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
