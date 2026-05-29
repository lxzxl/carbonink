#!/usr/bin/env node
/**
 * Reset the dev SQLite DB and re-seed mock data — headless (no GUI/onboarding).
 *
 * Why this exists: the app migrates via Vite's `import.meta.glob`, which only
 * works inside the electron-vite bundle, so `runMigrations` can't be called from
 * plain node. And once a migration is recorded in `schema_migrations`, an *edit*
 * to that migration file won't re-run on an existing DB — so changing a CHECK
 * (e.g. adding the `finalized` questionnaire status to migration 017) requires a
 * fresh DB. This script gives you that fresh DB + mock data without launching the
 * app or re-doing onboarding.
 *
 * What it does:
 *   1. Backs up the current DB (→ `<db>.bak-<ts>`) and reads its org/site/period.
 *   2. Creates a fresh DB and replays every `migrations/NNN_*.sql` in order,
 *      recording each in `schema_migrations` exactly like the real runner — so the
 *      app treats them as already-applied on next launch.
 *   3. Re-inserts the carried-over organization + site + reporting_period (the
 *      onboarding essentials the seed needs).
 *   4. Runs `seed-test-data.mjs` against the fresh DB.
 *
 * Usage:  node scripts/reset-dev-db.mjs [--db /path/to/app.sqlite]
 *
 * ABI note: run under plain node (Node ABI). The .sqlite file itself is
 * ABI-independent, so the Electron app opens the same file fine afterward.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'src', 'main', 'db', 'migrations');
const SEED_SCRIPT = join(__dirname, 'seed-test-data.mjs');

const { values } = parseArgs({ options: { db: { type: 'string' } } });
const DB_PATH =
  values.db ?? join(homedir(), 'Library', 'Application Support', 'CarbonInk', 'app.sqlite');

// ── 1. Carry over onboarding rows from the old DB, then back it up ──
const carry = { organization: [], site: [], reporting_period: [] };
if (existsSync(DB_PATH)) {
  const old = new Database(DB_PATH, { readonly: true });
  for (const table of Object.keys(carry)) {
    try {
      carry[table] = old.prepare(`SELECT * FROM ${table}`).all();
    } catch {
      /* table may not exist in an older schema — skip */
    }
  }
  old.close();
  const backup = `${DB_PATH}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  renameSync(DB_PATH, backup);
  console.log(`✓ backed up old DB → ${backup}`);
  console.log(
    `  carried over: ${carry.organization.length} org, ${carry.site.length} site, ${carry.reporting_period.length} period`,
  );
} else {
  console.log('· no existing DB — creating fresh');
}

// ── 2. Fresh DB + replay migrations (mirror the real runner) ──
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

const migrations = readdirSync(MIGRATIONS_DIR)
  .filter((f) => /^\d{3}_.+\.sql$/.test(f))
  .sort((a, b) => a.localeCompare(b))
  .map((f) => ({ version: Number.parseInt(f.slice(0, 3), 10), name: f.replace(/\.sql$/, ''), file: f }));

for (const m of migrations) {
  db.exec(readFileSync(join(MIGRATIONS_DIR, m.file), 'utf8'));
  db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
    m.version,
    m.name,
    new Date().toISOString(),
  );
}
console.log(`✓ applied ${migrations.length} migrations (000..${migrations.at(-1).version})`);

// ── 3. Re-insert carried-over onboarding rows (org → site → period: FK order) ──
const insertRows = (table, rows) => {
  for (const row of rows) {
    const cols = Object.keys(row);
    db.prepare(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    ).run(...cols.map((c) => row[c]));
  }
};
// Restore a known-consistent snapshot: disable FK checks during the copy. The
// rows were already FK-valid together in the source DB, but some may reference a
// table we don't carry (e.g. a settings/user row), so insertion order alone isn't
// enough. Must toggle the pragma OUTSIDE a transaction (it's a no-op inside one).
db.pragma('foreign_keys = OFF');
insertRows('organization', carry.organization);
insertRows('site', carry.site);
insertRows('reporting_period', carry.reporting_period);
db.pragma('foreign_keys = ON');
db.close();
if (carry.organization.length > 0) console.log('✓ re-inserted org/site/period');

// ── 4. Seed mock data via the existing script ──
console.log('· seeding mock data…');
execFileSync('node', [SEED_SCRIPT, '--db', DB_PATH], { stdio: 'inherit' });
console.log('\n✓ dev DB reset + re-seeded.');
