import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runMigrations } from '@main/db/migrate';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = join(__dirname, '../../../../src/main/db/migrations');

/**
 * Inline `runMigrationsUpTo(db, n)` so we can exercise the backfill behavior
 * of migration 017 on rows that existed under the pre-017 schema. We can't
 * use `runMigrations(db)` from `@main/db/migrate` because it applies every
 * migration including 017; we need to seed pre-017 first.
 *
 * Reads SQL files from disk (rather than via Vite's `import.meta.glob`)
 * because Vitest's node project doesn't go through electron-vite's bundling
 * pass; raw fs is the simplest portable path.
 */
function runMigrationsUpTo(db: Database.Database, maxVersion: number): void {
  const entries = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort();

  db.pragma('foreign_keys = ON');

  // Bootstrap: explicitly run 000_meta first if schema_migrations doesn't exist.
  // (Matches the bootstrap logic in `@main/db/migrate`.)
  const tableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
    .get();
  if (!tableExists) {
    const bootstrap = entries.find((f) => /^000_/.test(f));
    if (!bootstrap) throw new Error('Missing 000_meta migration');
    db.exec(readFileSync(join(MIGRATIONS_DIR, bootstrap), 'utf8'));
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
      0,
      bootstrap.replace(/\.sql$/, ''),
      new Date().toISOString(),
    );
  }

  for (const file of entries) {
    const match = file.match(/^(\d{3})_(.+)\.sql$/);
    if (!match) continue;
    const version = Number.parseInt(match[1] as string, 10);
    if (version === 0) continue;
    if (version > maxVersion) break;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    db.pragma('foreign_keys = OFF');
    try {
      const tx = db.transaction(() => {
        db.exec(sql);
        db.prepare(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
        ).run(version, file.replace(/\.sql$/, ''), new Date().toISOString());
      });
      tx();
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }
}

/**
 * Seed a minimal organization → site → reporting_period chain that
 * activity_data needs for its (site, emission_source, reporting_period)
 * foreign keys. Returns the IDs the caller may need.
 */
function seedOrgSitePeriod(db: Database.Database): {
  org_id: string;
  site_id: string;
  period_id: string;
  emission_source_id: string;
  ef_factor_code: string;
  ef_year: number;
  ef_source: string;
  ef_geography: string;
  ef_dataset_version: string;
} {
  const org_id = 'org_1';
  const site_id = 'site_1';
  const period_id = 'period_1';
  const emission_source_id = 'src_1';
  db.prepare(
    `INSERT INTO organization (id, country_code, boundary_kind, created_at, updated_at)
     VALUES (?, 'CN', 'operational_control', '2026-01-01', '2026-01-01')`,
  ).run(org_id);
  db.prepare(
    `INSERT INTO site (id, organization_id, country_code, created_at, updated_at)
     VALUES (?, ?, 'CN', '2026-01-01', '2026-01-01')`,
  ).run(site_id, org_id);
  db.prepare(
    `INSERT INTO reporting_period (id, organization_id, year, granularity, starts_at, ends_at, created_at)
     VALUES (?, ?, 2025, 'annual', '2025-01-01', '2025-12-31', '2026-01-01')`,
  ).run(period_id, org_id);
  db.prepare(
    `INSERT INTO emission_source (id, site_id, name, scope, category)
     VALUES (?, ?, 'Test source', 1, 'electricity')`,
  ).run(emission_source_id, site_id);

  // Pin a synthetic EF directly — production pins from emission_factor at boot,
  // but for migration testing we just need *some* row the FK can resolve to.
  const ef_factor_code = 'test.kwh';
  const ef_year = 2025;
  const ef_source = 'MEE';
  const ef_geography = 'CN';
  const ef_dataset_version = '2025.1';
  db.prepare(
    `INSERT INTO pinned_emission_factor (factor_code, year, source, geography, dataset_version,
        scope, category, input_unit, co2e_kg_per_unit, gwp_basis,
        name_zh, name_en, description_zh, description_en, ghg_protocol_path, citation_url,
        pinned_at, pinned_from)
     VALUES (?, ?, ?, ?, ?, 2, 'electricity', 'kWh', 0.5, 'AR6',
             '测试', 'Test', NULL, NULL, NULL, NULL, '2026-01-01', 'app.sqlite')`,
  ).run(ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version);

  return {
    org_id,
    site_id,
    period_id,
    emission_source_id,
    ef_factor_code,
    ef_year,
    ef_source,
    ef_geography,
    ef_dataset_version,
  };
}

describe('migration 017 — inbound questionnaire schema', () => {
  it('backfills direction=outbound + role=customer + null tier/inbound_* on existing rows', () => {
    const db = new Database(':memory:');
    runMigrationsUpTo(db, 16);

    const env = seedOrgSitePeriod(db);

    // Pre-017 inserts (under the old schema):
    db.prepare(`INSERT INTO customer (id, name, notes) VALUES ('cu_1', 'Acme Corp', NULL)`).run();
    db.prepare(
      `INSERT INTO document (id, sha256, filename, mime_type, size_bytes, storage_path, uploaded_at)
       VALUES ('doc_1', 'sha', 'q.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 100, '/tmp/q.xlsx', '2026-05-15T00:00:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO questionnaire (id, customer_id, document_id, reporting_year, status, due_date, created_at)
       VALUES ('qn_1', 'cu_1', 'doc_1', 2025, 'mapping', NULL, '2026-05-15T00:00:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO question (id, questionnaire_id, question_signature, signature_version,
          normalized_text, raw_text, parsed_intent, question_kind, expected_unit, position, required)
       VALUES ('q_1', 'qn_1', 'sig1', 'v1', 'how much electricity', 'How much electricity?', NULL, 'numerical', 'kWh', 'A1', 1)`,
    ).run();
    db.prepare(
      `INSERT INTO activity_data (
         id, site_id, emission_source_id, reporting_period_id,
         occurred_at_start, occurred_at_end, amount, unit,
         ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
         computed_co2e_kg, computed_at, notes, created_at, updated_at)
       VALUES ('ad_1', ?, ?, ?,
         '2025-01-01', '2025-12-31', 100.0, 'kWh',
         ?, ?, ?, ?, ?,
         50.0, '2026-05-15T00:00:00Z', NULL, '2026-05-15T00:00:00Z', '2026-05-15T00:00:00Z')`,
    ).run(
      env.site_id,
      env.emission_source_id,
      env.period_id,
      env.ef_factor_code,
      env.ef_year,
      env.ef_source,
      env.ef_geography,
      env.ef_dataset_version,
    );

    // Apply 017 (the only remaining migration after up-to-16).
    runMigrations(db);

    const qn = db.prepare(`SELECT * FROM questionnaire WHERE id = 'qn_1'`).get() as {
      direction: string;
      document_id: string | null;
      status: string;
    };
    expect(qn.direction).toBe('outbound');
    expect(qn.document_id).toBe('doc_1');
    expect(qn.status).toBe('mapping');

    const cu = db.prepare(`SELECT role FROM customer WHERE id = 'cu_1'`).get() as { role: string };
    expect(cu.role).toBe('customer');

    const q = db.prepare(`SELECT tier FROM question WHERE id = 'q_1'`).get() as {
      tier: number | null;
    };
    expect(q.tier).toBeNull();

    const ad = db
      .prepare(`SELECT inbound_question_id, inbound_tier FROM activity_data WHERE id = 'ad_1'`)
      .get() as {
      inbound_question_id: string | null;
      inbound_tier: number | null;
    };
    expect(ad.inbound_question_id).toBeNull();
    expect(ad.inbound_tier).toBeNull();

    db.close();
  });

  it('accepts a fresh inbound draft row with direction=inbound, status=draft, role=supplier, tier=1, inbound_tier=2', () => {
    const db = new Database(':memory:');
    runMigrations(db);

    const env = seedOrgSitePeriod(db);

    db.prepare(
      `INSERT INTO customer (id, name, notes, role) VALUES ('su_1', 'Acme Steel', NULL, 'supplier')`,
    ).run();

    // Inbound drafts can have NULL document_id now.
    db.prepare(
      `INSERT INTO questionnaire (id, customer_id, document_id, reporting_year, status, direction, due_date, created_at)
       VALUES ('qn_in_1', 'su_1', NULL, 2025, 'draft', 'inbound', NULL, '2026-05-15T00:00:00Z')`,
    ).run();

    db.prepare(
      `INSERT INTO question (id, questionnaire_id, question_signature, signature_version,
          normalized_text, raw_text, parsed_intent, question_kind, expected_unit, position, required, tier)
       VALUES ('q_in_1', 'qn_in_1', 'sig_in', 'v1', 'pcf', 'Per-kg PCF', NULL, 'numerical', 'kgCO2e/kg', 'tier1.1', 0, 1)`,
    ).run();

    db.prepare(
      `INSERT INTO activity_data (
         id, site_id, emission_source_id, reporting_period_id,
         occurred_at_start, occurred_at_end, amount, unit,
         ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
         computed_co2e_kg, computed_at, notes, created_at, updated_at,
         inbound_question_id, inbound_tier)
       VALUES ('ad_in_1', ?, ?, ?,
         '2025-01-01', '2025-12-31', 12000.0, 'kgCO2e',
         ?, ?, ?, ?, ?,
         12000.0, '2026-05-15T00:00:00Z', NULL, '2026-05-15T00:00:00Z', '2026-05-15T00:00:00Z',
         'q_in_1', 2)`,
    ).run(
      env.site_id,
      env.emission_source_id,
      env.period_id,
      env.ef_factor_code,
      env.ef_year,
      env.ef_source,
      env.ef_geography,
      env.ef_dataset_version,
    );

    const qn = db.prepare(`SELECT * FROM questionnaire WHERE id = 'qn_in_1'`).get() as {
      direction: string;
      status: string;
      document_id: string | null;
    };
    expect(qn.direction).toBe('inbound');
    expect(qn.status).toBe('draft');
    expect(qn.document_id).toBeNull();

    const cu = db.prepare(`SELECT role FROM customer WHERE id = 'su_1'`).get() as { role: string };
    expect(cu.role).toBe('supplier');

    const q = db.prepare(`SELECT tier FROM question WHERE id = 'q_in_1'`).get() as { tier: number };
    expect(q.tier).toBe(1);

    const ad = db
      .prepare(`SELECT inbound_question_id, inbound_tier FROM activity_data WHERE id = 'ad_in_1'`)
      .get() as { inbound_question_id: string; inbound_tier: number };
    expect(ad.inbound_question_id).toBe('q_in_1');
    expect(ad.inbound_tier).toBe(2);

    db.close();
  });

  it('rejects a questionnaire status outside the widened enum', () => {
    const db = new Database(':memory:');
    runMigrations(db);

    db.prepare(`INSERT INTO customer (id, name) VALUES ('cu_2', 'X')`).run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO questionnaire (id, customer_id, document_id, reporting_year, status, direction, due_date, created_at)
           VALUES ('qn_bad', 'cu_2', NULL, 2025, 'garbage', 'inbound', NULL, '2026-05-15T00:00:00Z')`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/i);

    db.close();
  });

  it('rejects a customer.role outside (customer, supplier)', () => {
    const db = new Database(':memory:');
    runMigrations(db);

    expect(() =>
      db.prepare(`INSERT INTO customer (id, name, role) VALUES ('cu_3', 'Z', 'partner')`).run(),
    ).toThrow(/CHECK constraint failed/i);

    db.close();
  });

  it('rejects a question.tier outside (1, 2)', () => {
    const db = new Database(':memory:');
    runMigrations(db);

    db.prepare(`INSERT INTO customer (id, name) VALUES ('cu_4', 'Y')`).run();
    db.prepare(
      `INSERT INTO questionnaire (id, customer_id, document_id, reporting_year, status, direction, due_date, created_at)
       VALUES ('qn_4', 'cu_4', NULL, 2025, 'draft', 'inbound', NULL, '2026-05-15T00:00:00Z')`,
    ).run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO question (id, questionnaire_id, question_signature, signature_version,
              normalized_text, raw_text, parsed_intent, question_kind, expected_unit, position, required, tier)
           VALUES ('q_bad', 'qn_4', 's', 'v1', 'n', 'r', NULL, 'numerical', NULL, 'p', 0, 3)`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/i);

    db.close();
  });

  it('creates partial index idx_activity_inbound_q', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const idx = db
      .prepare(
        `SELECT name, sql FROM sqlite_master WHERE type='index' AND name='idx_activity_inbound_q'`,
      )
      .get() as { name: string; sql: string } | undefined;
    expect(idx).toBeDefined();
    expect(idx?.sql).toContain('inbound_question_id');
    db.close();
  });
});
